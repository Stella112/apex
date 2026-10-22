// Apex service: one place that wires client, registry, Circuit, Shield, referee, proposals,
// PAPER/LIVE execution and the decision log. Used by the MCP server and the dashboard API.
import { CREDIT_SHARED, PROPOSAL_TTL_MS, RECONCILE_TIMEOUT_MS, type SessionEntry } from "@apex/config";
import { type FairValue, fairValue, referenceFor } from "./fairvalue.js";
import { MANDATE, type VaultState, drawdownPct, initialVaultState, mandatePolicy, reversionSignal } from "./vault.js";
import { boundaryPrice, completionTargets, conversionPrice, fixAmounts, health, paramsFrom, stressGrid } from "./credit.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getBalances, getOrderHistory, getPositions } from "./account.js";
import { type AccountView, type CircuitData, type CircuitInput, type CircuitReport, runCircuit, walkDepth } from "./circuit.js";
import { loadCircuitData, loadLiveAccount } from "./circuit-data.js";
import { DecisionLog, type LogEntry, canonicalJSON, loadOrCreateLogSigner, verifyLog } from "./decision-log.js";
import { StrikeClient, type StrikeEnv } from "./http.js";
import { accountLiquidations } from "./margin.js";
import { getCollateralAssets, getCreditSettings, getDepth, getMarkets, getProtocolVaults, getVault } from "./market.js";
import { D, dec } from "./money.js";
import {
  type PaperState, PaperError, loadPaper, paperAddStop, paperCancel, paperCheckStops, paperClose, paperFree, paperIsoAdd, paperOpen,
  paperPositionsWithLiq, savePaper,
} from "./paper.js";
import { DEFAULT_POLICY, type Policy, PolicySchema, mergePolicy } from "./policy.js";
import { type Action, type Mode, type RefereeContext, type Verdict, evaluate, isReduction } from "./referee.js";
import { MarketRegistry, type MarketRecord, type RegistryClass } from "./registry.js";
import type { MarketInfo } from "./schemas.js";
import { type Flag, type GapDistribution, band, flagsFor, gapDistribution, pGap } from "./shield.js";
import { type MarketGapStats, type PositionGapRisk, type PositionInputView, loadMarkHistory, marketGapStats, positionGapRisk } from "./shield-report.js";
import { parseApiWalletKey } from "./signing.js";
import { addIsoMargin, cancelOrder, placeOrder, reconcileIsoMargin, reconcileOrder } from "./trading.js";

export type PositionSource = "own" | "paper" | "vault";

export interface ApexOptions {
  env: StrikeEnv;
  publicKey?: string;
  privateKey?: string;
  /** APEX_MODE: "live" enables the LIVE path (still needs referee + human confirmation). */
  apexMode: "paper" | "live";
  stateDir: string;
  logSigningKey?: string;
  vaultId?: string;
  now?: () => number;
  client?: StrikeClient;
}

export interface Proposal {
  id: string;
  createdAt: string;
  expiresAt: number;
  mode: Mode;
  action: Action;
  /** Leverage for paper opens. */
  leverage?: number;
  circuit?: unknown;
  verdict: Verdict;
  paramsHash: string;
  status: "proposed" | "executed" | "rejected" | "expired";
  source: PositionSource;
  summary: string;
}

export interface ExecutionResult {
  proposalId: string;
  mode: Mode;
  status: string;
  label: "LIVE" | "PAPER";
  details: unknown;
  verdict: Verdict;
  logSeq: number;
}

/** Run async work with bounded concurrency (keeps a 20-market report well under MCP's 60 s timeout). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]!);
    }
  }));
  return out;
}

const hashAction = (a: Action) => bytesToHex(sha256(utf8ToBytes(canonicalJSON(a))));

export class Apex {
  readonly client: StrikeClient;
  readonly registry: MarketRegistry;
  readonly log: DecisionLog;
  readonly apexMode: "paper" | "live";
  private readonly now: () => number;
  private readonly files: { paper: string; policy: string; proposals: string; log: string; logKey: string; vaultPaper: string; vaultState: string };
  readonly vaultId: string | undefined;

  constructor(o: ApexOptions) {
    const key = o.publicKey && o.privateKey ? parseApiWalletKey(o.publicKey, o.privateKey) : undefined;
    this.now = o.now ?? Date.now;
    this.client = o.client ?? new StrikeClient({ env: o.env, key, now: this.now });
    this.registry = new MarketRegistry(this.client, this.now);
    this.apexMode = o.apexMode;
    this.vaultId = o.vaultId || undefined;
    mkdirSync(o.stateDir, { recursive: true });
    this.files = {
      paper: join(o.stateDir, "paper.json"),
      policy: join(o.stateDir, "policy.json"),
      proposals: join(o.stateDir, "proposals.json"),
      log: join(o.stateDir, "decisions.jsonl"),
      logKey: join(o.stateDir, "..", "keys", "log_signing.key"),
      vaultPaper: join(o.stateDir, "vault-paper.json"),
      vaultState: join(o.stateDir, "vault-state.json"),
    };
    this.log = new DecisionLog(this.files.log, loadOrCreateLogSigner(o.logSigningKey, this.files.logKey), this.now);
  }

  get hasKeys(): boolean {
    return this.client.hasKeys;
  }

  /** Mode for new actions: LIVE only when APEX_MODE=live and keys exist; otherwise PAPER. */
  get mode(): Mode {
    return this.apexMode === "live" && this.hasKeys ? "live" : "paper";
  }

  defaultSource(): PositionSource {
    return this.hasKeys ? "own" : "paper";
  }

  // ── policy ─────────────────────────────────────────────────────────────────
  getPolicy(): Policy {
    if (!existsSync(this.files.policy)) return DEFAULT_POLICY;
    return PolicySchema.parse(JSON.parse(readFileSync(this.files.policy, "utf8")));
  }

  setPolicy(patch: unknown): Policy {
    const next = mergePolicy(this.getPolicy(), patch);
    writeFileSync(this.files.policy, JSON.stringify(next, null, 2));
    this.log.append("policy_update", "paper", { patch, policy: next });
    return next;
  }

  // ── markets ────────────────────────────────────────────────────────────────
  async markets(): Promise<MarketRecord[]> {
    if (!this.registry.current || this.now() - this.registry.current.fetchedAt > 60_000) await this.registry.load();
    return this.registry.current!.markets;
  }

  async listMarkets(filter: { class?: RegistryClass; openOnly?: boolean } = {}) {
    const ms = await this.markets();
    return ms.filter((m) => (!filter.class || m.class === filter.class) && (!filter.openOnly || m.sessionState.underlying === "open"));
  }

  async market(symbol: string): Promise<MarketRecord> {
    const m = (await this.markets()).find((x) => x.symbol === symbol);
    if (!m) throw new Error(`Unknown symbol ${symbol}. Symbols are case-sensitive, e.g. NVDA-USD.`);
    return m;
  }

  async getMarket(symbol: string) {
    const m = await this.market(symbol);
    const [depth, klines] = await Promise.all([getDepth(this.client, symbol).catch(() => null), loadMarkHistory(this.client, symbol, 3, this.now())]);
    const mark = dec(m.stats.markPrice);
    const { stats } = marketGapStats(m, klines, depth?.data ?? null, this.now());
    const summary = depth ? {
      bestBid: depth.data.bids[0]?.[0] ?? null,
      bestAsk: depth.data.asks[0]?.[0] ?? null,
      spreadBps: depth.data.bids[0] && depth.data.asks[0] ? dec(depth.data.asks[0][0]).sub(dec(depth.data.bids[0][0])).div(mark).mul(10000).toFixed(2) : null,
      levels: { bids: depth.data.bids.length, asks: depth.data.asks.length },
      label: "LIVE",
    } : null;
    return { market: m, depth: summary, gap: stats };
  }

  // ── accounts and positions ─────────────────────────────────────────────────
  private paper(): PaperState {
    return loadPaper(this.files.paper);
  }

  private async marketsInfo(): Promise<{ markets: Record<string, MarketInfo>; fetchedAt: number }> {
    const r = await getMarkets(this.client);
    return { markets: r.data.markets, fetchedAt: r.fetchedAt };
  }

  /** Paper ledger with stops checked against current marks. */
  private async paperRefreshed(): Promise<PaperState> {
    let s = this.paper();
    if (!s.orders.some((o) => o.status === "resting")) return s;
    const { markets } = await this.marketsInfo();
    const marks = Object.fromEntries(Object.entries(markets).map(([k, v]) => [k, v.mark_price]));
    const before = s.fills.length;
    s = paperCheckStops(s, marks, await this.takerRate(), new Date(this.now()).toISOString());
    if (s.fills.length !== before) {
      savePaper(this.files.paper, s);
      this.log.append("paper_stop_triggered", "paper", { fills: s.fills.slice(before) });
    }
    return s;
  }

  private async takerRate(): Promise<string> {
    const r = await this.client.publicGet("/v2/fee-tiers", undefined, (await import("./schemas.js")).FeeTiers);
    const t = r.data.feeTiers.find((x) => x.Tier === 0);
    if (!t) throw new Error("fee tier 0 missing");
    return String(t.TakerRate);
  }

  private async vault(): Promise<string> {
    if (this.vaultId) return this.vaultId;
    const v = (await getProtocolVaults(this.client)).data.vaults[0];
    if (!v) throw new Error("no protocol vault found");
    return v.vault_id;
  }

  /** Positions with liquidation price, from the chosen source. */
  async positionViews(source: PositionSource): Promise<{ label: string; positions: PositionInputView[]; walletBalance: string | null; fetchedAt: number; markets: Record<string, MarketInfo>; marketsFetchedAt: number }> {
    const mk = await this.marketsInfo();
    if (source === "paper") {
      const s = await this.paperRefreshed();
      const mm = Object.fromEntries(Object.entries(mk.markets).map(([k, m]) => [k, { tiers: m.margin_tiers, quotePrec: m.quote_prec, mark: m.mark_price }]));
      return { label: "PAPER", positions: paperPositionsWithLiq(s, mm), walletBalance: s.walletBalance, fetchedAt: this.now(), markets: mk.markets, marketsFetchedAt: mk.fetchedAt };
    }
    const scope = source === "vault" ? { vaultId: await this.vault() } : {};
    const [pos, bal] = await Promise.all([getPositions(this.client, scope), getBalances(this.client, scope)]);
    return {
      label: source === "vault" ? `LIVE (vault ${scope.vaultId}, public read-only — not your account)` : "LIVE",
      positions: pos.data.positions,
      walletBalance: bal.data[0]?.walletBalance ?? null,
      fetchedAt: Math.min(pos.fetchedAt, bal.fetchedAt),
      markets: mk.markets,
      marketsFetchedAt: mk.fetchedAt,
    };
  }

  async accountSummary(source: PositionSource = this.defaultSource()) {
    if (source === "paper") {
      const s = await this.paperRefreshed();
      return {
        label: "PAPER", walletBalance: s.walletBalance, freeBalance: paperFree(s).toFixed(2), positions: s.positions.length,
        restingStops: s.orders.filter((o) => o.status === "resting").length, note: "Apex paper account; no funds at risk.",
      };
    }
    const scope = source === "vault" ? { vaultId: await this.vault() } : {};
    const { getAccount } = await import("./account.js");
    const a = await getAccount(this.client, scope);
    return { label: source === "vault" ? "LIVE (vault, public read-only)" : "LIVE", ...a.data };
  }

  private accountView(v: Awaited<ReturnType<Apex["positionViews"]>>, source: PositionSource): AccountView | null {
    if (v.walletBalance === null) return null;
    return {
      source: source === "paper" ? "PAPER" : "LIVE",
      walletBalance: v.walletBalance,
      positions: v.positions,
      marginModeFor: () => (source === "paper" ? "isolated" : "cross"),
      fetchedAt: v.fetchedAt,
    };
  }

  private actionsInLastHour(): number {
    const cutoff = this.now() - 3600_000;
    return this.log.entries().filter((e) => e.type === "execution" && Date.parse(e.ts) >= cutoff && !(e.payload as { reduction?: boolean })?.reduction).length;
  }

  private async dist(m: MarketRecord): Promise<{ dist: GapDistribution; flags: Flag[] }> {
    const isCrypto = m.class === "crypto";
    if (isCrypto) return { dist: gapDistribution(undefined, [], this.now()), flags: [] };
    const [k, depth] = await Promise.all([loadMarkHistory(this.client, m.symbol, 3, this.now()), getDepth(this.client, m.symbol).catch(() => null)]);
    const entry: SessionEntry | undefined = m.session ?? (isCrypto ? undefined : { symbol: m.symbol, class: "equity", venue: "unknown", tz: "UTC", schedule: { kind: "unknown" }, source: "none" });
    return { dist: gapDistribution(entry, k, this.now()), flags: flagsFor(m.session, isCrypto, k, depth?.data ?? null, dec(m.stats.markPrice)) };
  }

  async positionsWithRisk(source: PositionSource = this.defaultSource(), force = false): Promise<{ label: string; positions: PositionGapRisk[]; asOf: string }> {
    const ms = await this.markets();
    const policy = this.getPolicy();
    // Slow history reads first; account/positions last so they are fresh for the referee (R8).
    const pre = await this.positionViews(source);
    const symbols = [...new Set(pre.positions.map((p) => p.symbol))];
    const distMap = new Map<string, { dist: GapDistribution; flags: Flag[] }>();
    await mapLimit(symbols, 8, async (s) => {
      const m = ms.find((x) => x.symbol === s);
      if (m) distMap.set(s, await this.dist(m));
    });
    const views = await this.positionViews(source);
    const data: CircuitData = {
      now: this.now(), mode: this.mode, liveEnvEnabled: this.apexMode === "live", market: undefined, markets: views.markets,
      marketsFetchedAt: views.marketsFetchedAt, depth: null, depthFetchedAt: this.now(), feeTiers: null,
      account: this.accountView(views, source), actionsInLastHour: this.actionsInLastHour(),
    };
    const out = views.positions.map((p) =>
      positionGapRisk(p, views.positions, {
        policy,
        circuitData: data,
        registry: (s) => ms.find((m) => m.symbol === s),
        dist: (s) => distMap.get(s)?.dist ?? gapDistribution(undefined, [], this.now()),
        flags: (s) => distMap.get(s)?.flags ?? [],
        positionsLabel: views.label,
      }, force),
    );
    return { label: views.label, positions: out, asOf: new Date(this.now()).toISOString() };
  }

  private gapStatsCache: { at: number; rows: Array<MarketGapStats & { fairValue: FairValue | null }> } | undefined;

  /** Closed-session statistics for every non-crypto market (cached 60 s; history is cached 10 min). */
  async marketGapStatsAll(): Promise<Array<MarketGapStats & { fairValue: FairValue | null }>> {
    if (this.gapStatsCache && this.now() - this.gapStatsCache.at < 60_000) return this.gapStatsCache.rows;
    const ms = await this.markets();
    const tradfi = ms.filter((m) => m.class !== "crypto");
    const rows: Array<MarketGapStats & { fairValue: FairValue | null }> = await mapLimit(tradfi, 8, async (m) => {
      const [k, depth] = await Promise.all([loadMarkHistory(this.client, m.symbol, 3, this.now()), getDepth(this.client, m.symbol).catch(() => null)]);
      const fv = m.class === "equity" || m.class === "index" ? await this.fairValue(m.symbol).catch(() => null) : null;
      return { ...marketGapStats(m, k, depth?.data ?? null, this.now()).stats, fairValue: fv };
    });
    this.gapStatsCache = { at: this.now(), rows };
    return rows;
  }

  async weekendRiskReport(source: PositionSource = this.defaultSource(), opts: { log?: boolean } = {}) {
    const [markets, positions] = await Promise.all([this.marketGapStatsAll(), this.positionsWithRisk(source)]);
    const entry = opts.log === false ? null : this.log.append("weekend_report", "scenario", {
      source, positions: positions.positions.map((p) => ({ symbol: p.symbol, band: p.band, pGapPct: p.pGapPct, method: p.method, samples: p.samples })),
    });
    return { asOf: new Date(this.now()).toISOString(), mode: this.mode, positionsLabel: positions.label, markets, positions: positions.positions, logSeq: entry?.seq ?? null };
  }

  /** Last `hours` 1h mark closes (from the cached history) for sparklines. LIVE. */
  async markHistory(symbol: string, hours = 96): Promise<{ symbol: string; closes: string[]; from: number | null; to: number | null }> {
    const k = await loadMarkHistory(this.client, symbol, 3, this.now());
    const tail = k.slice(-hours);
    return { symbol, closes: tail.map((x) => x.close), from: tail[0]?.openTime ?? null, to: tail.at(-1)?.closeTime ?? null };
  }

  async orderHistory(source: PositionSource = this.defaultSource(), symbol?: string) {
    if (source === "paper") {
      const s = this.paper();
      return { label: "PAPER", orders: s.orders, fills: s.fills.slice(-50) };
    }
    const scope = source === "vault" ? { vaultId: await this.vault() } : {};
    const r = await getOrderHistory(this.client, scope, { symbol, limit: 50 });
    return { label: source === "vault" ? "LIVE (vault, public read-only)" : "LIVE", orders: r.data.orders };
  }

  // ── Circuit ────────────────────────────────────────────────────────────────
  /** source "none" = no account: Circuit models the trade on its own (isolated-equivalent). */
  private async circuitData(symbol: string, source: PositionSource | "none"): Promise<CircuitData> {
    const m = await this.market(symbol);
    let gap: CircuitData["gap"];
    if (m.class !== "crypto") {
      const { dist } = await this.dist(m);
      gap = { pGap: null, band: "N/A", method: dist.method, samples: dist.samples };
    }
    // Account read last so its age at evaluation stays inside the 15 s freshness limit.
    const views = source === "none" ? null : await this.positionViews(source).catch(() => null);
    const account = views && source !== "none" ? this.accountView(views, source) : null;
    return loadCircuitData(this.client, this.registry, symbol, {
      mode: this.mode, liveEnvEnabled: this.apexMode === "live", account, actionsInLastHour: this.actionsInLastHour(), now: this.now, ...(gap ? { gap } : {}),
    });
  }

  async simulateTrade(input: CircuitInput, source: PositionSource | "none" = this.defaultSource(), opts: { log?: boolean } = {}): Promise<CircuitReport> {
    await this.market(input.symbol);
    const data = await this.circuitData(input.symbol, source);
    const report = runCircuit(input, data, this.getPolicy());
    await this.attachTradeGap(report);
    if (report.alternativeReport) await this.attachTradeGap(report.alternativeReport);
    if (opts.log !== false) this.log.append("simulation", "scenario", {
      input, decision: report.verdict.decision, violations: report.verdict.violations.map((v) => v.id),
      alternative: report.verdict.alternative ?? null,
    });
    return report;
  }

  /** Weekend Shield p_gap for the simulated position: P(adverse closed-session move ≥ its liquidation distance). */
  private async attachTradeGap(r: Omit<CircuitReport, "alternativeReport">): Promise<void> {
    const m = await this.market(r.symbol);
    if (m.class === "crypto") return;
    const { dist } = await this.dist(m);
    const d = r.liquidation.distancePct.value === null ? null : Number(r.liquidation.distancePct.value) / 100;
    const p = d === null ? (r.liquidation.price.value?.startsWith("0") ? 0 : null) : pGap(dist, r.side === "buy" ? "long" : "short", d);
    r.weekend.gap = { pGap: p === null ? null : (p * 100).toFixed(1), band: band(p), method: dist.method, samples: dist.samples };
  }

  async stressTestPosition(symbol: string, movesPct: string[], source: PositionSource = this.defaultSource()) {
    const views = await this.positionViews(source);
    const p = views.positions.find((x) => x.symbol === symbol);
    if (!p) throw new Error(`No ${symbol} position in ${views.label}`);
    const info = views.markets[symbol];
    if (!info) throw new Error(`No market data for ${symbol}`);
    const mark = dec(info.mark_price), size = dec(p.size), liq = dec(p.liquidation_price);
    const rows = movesPct.map((m) => {
      const k = dec(m).div(100);
      const price = size.isPos() ? mark.mul(new D(1).sub(k)) : mark.mul(new D(1).add(k));
      const pnl = price.sub(dec(p.entry_price)).mul(size);
      const liquidated = !liq.isZero() && (size.isPos() ? price.lte(liq) : price.gte(liq));
      return { adverseMovePct: m, price: price.toSignificantDigits(10).toString(), unrealizedPnlUsd: pnl.toFixed(2), liquidated, label: "SCENARIO" };
    });
    return { label: views.label, symbol, size: p.size, entry: p.entry_price, mark: info.mark_price, liquidationPrice: p.liquidation_price, rows, note: "Other positions and the wallet held constant; before fees and funding." };
  }

  // ── proposals ──────────────────────────────────────────────────────────────
  private proposals(): Record<string, Proposal> {
    if (!existsSync(this.files.proposals)) return {};
    return JSON.parse(readFileSync(this.files.proposals, "utf8")) as Record<string, Proposal>;
  }

  private saveProposal(p: Proposal): void {
    const all = this.proposals();
    all[p.id] = p;
    // Keep the file small: drop proposals older than a day.
    for (const [k, v] of Object.entries(all)) if (this.now() - v.expiresAt > 86_400_000) delete all[k];
    const tmp = `${this.files.proposals}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2));
    renameSync(tmp, this.files.proposals);
  }

  getProposal(id: string): Proposal | undefined {
    return this.proposals()[id];
  }

  private store(action: Action, verdict: Verdict, source: PositionSource, summary: string, extra: { leverage?: number; circuit?: unknown } = {}): Proposal {
    const p: Proposal = {
      id: randomUUID(),
      createdAt: new Date(this.now()).toISOString(),
      expiresAt: this.now() + PROPOSAL_TTL_MS,
      mode: this.mode,
      action,
      ...extra,
      verdict,
      paramsHash: hashAction(action),
      status: "proposed",
      source,
      summary,
    };
    this.saveProposal(p);
    this.log.append("proposal", p.mode, { id: p.id, action, decision: verdict.decision, violations: verdict.violations.map((v) => `${v.id}: ${v.message}`), source, summary });
    return p;
  }

  async proposeTrade(input: CircuitInput, source: PositionSource = this.defaultSource()): Promise<{ proposal: Proposal; circuit: CircuitReport }> {
    const circuit = await this.simulateTrade(input, source);
    const action: Action = { kind: "open", symbol: input.symbol, side: input.side, size: circuit.size.value ?? "0", orderType: input.orderType, ...(input.limitPrice ? { price: input.limitPrice } : {}), leverage: input.leverage };
    const summary = `${input.side} ${action.size} ${input.symbol} ${input.orderType} at ${input.leverage}x (≈ $${circuit.notionalUsd.value})`;
    const proposal = this.store(action, circuit.verdict, source, summary, { leverage: input.leverage, circuit: { notionalUsd: circuit.notionalUsd, liquidation: circuit.liquidation, fees: circuit.fees } });
    return { proposal, circuit };
  }

  async proposeProtection(symbol: string, kind?: "protective_stop" | "partial_close" | "iso_margin_add", source: PositionSource = this.defaultSource()) {
    const risk = await this.positionsWithRisk(source, true);
    const pos = risk.positions.find((p) => p.symbol === symbol);
    if (!pos) throw new Error(`No ${symbol} position in ${risk.label}`);
    const options = pos.suggestions.filter((s) => !kind || s.kind === kind);
    if (!options.length) return { position: pos, proposals: [] as Proposal[], note: `No ${kind ?? "protection"} proposal could be built for ${symbol} (see flags/notes).` };
    const proposals = options.map((s) => this.store(s.action, s.verdict, source, s.summary, { circuit: { after: s.after } }));
    return { position: pos, proposals, note: "Nothing has been sent. Call execute_proposal with confirm: true within 120 s to execute one." };
  }

  async proposeCancel(symbol: string, orderId: string, source: PositionSource = this.defaultSource()): Promise<Proposal> {
    const action: Action = { kind: "cancel", symbol, orderId };
    const ctx = this.baseCtx(await this.market(symbol), "propose", false, null, [], {});
    return this.store(action, evaluate(action, ctx, this.getPolicy()), source, `cancel order ${orderId} on ${symbol}`);
  }

  private baseCtx(m: MarketRecord, stage: "propose" | "execute", confirmed: boolean, markPrice: string | null, portfolio: RefereeContext["portfolio"], ages: Partial<RefereeContext["dataAgesMs"]>): RefereeContext {
    return {
      stage, mode: this.mode, liveEnvEnabled: this.apexMode === "live", humanConfirmed: confirmed,
      market: { symbol: m.symbol, class: m.class, perpStatus: m.perpStatus, underlying: m.sessionState.underlying, filters: m.filters },
      markPrice, dataAgesMs: { mark: ages.mark ?? null, depth: ages.depth ?? null, account: ages.account ?? null }, portfolio,
      liquidation: { kind: "none" }, actionsInLastHour: this.actionsInLastHour(),
    };
  }

  // ── execution ──────────────────────────────────────────────────────────────
  async executeProposal(id: string, confirm: boolean): Promise<ExecutionResult> {
    const p = this.getProposal(id);
    if (!p) throw new Error(`Unknown proposal ${id}`);
    const fail = (status: string, details: unknown, verdict: Verdict): ExecutionResult => {
      const e = this.log.append("execution_blocked", p.mode, { proposalId: id, status, details });
      this.saveProposal({ ...p, status: status === "expired" ? "expired" : "rejected" });
      return { proposalId: id, mode: p.mode, status, label: p.mode === "live" ? "LIVE" : "PAPER", details, verdict, logSeq: e.seq };
    };
    if (p.status !== "proposed") throw new Error(`Proposal ${id} is ${p.status}`);
    if (!confirm) return fail("not_confirmed", "execute_proposal requires confirm: true", p.verdict);
    if (this.now() > p.expiresAt) return fail("expired", `proposal expired at ${new Date(p.expiresAt).toISOString()}; propose again`, p.verdict);
    if (hashAction(p.action) !== p.paramsHash) return fail("params_changed", "paramsHash mismatch", p.verdict);
    if (p.mode !== this.mode) return fail("mode_changed", `proposal was ${p.mode}, Apex is now ${this.mode}`, p.verdict);

    // Re-fetch fresh data and re-run the referee at the execute stage (CLAUDE.md §6.4).
    await this.registry.load();
    const m = await this.market(p.action.symbol);
    let verdict: Verdict;
    let freshMark: string | null = null;
    let depth: Awaited<ReturnType<typeof getDepth>> | null = null;
    let views: Awaited<ReturnType<Apex["positionViews"]>> | null = null;
    if (p.action.kind === "open") {
      const data = await this.circuitData(p.action.symbol, p.source);
      const report = runCircuit({ symbol: p.action.symbol, side: p.action.side, size: p.action.size, leverage: p.action.leverage, orderType: p.action.orderType, ...(p.action.price ? { limitPrice: p.action.price } : {}) }, data, this.getPolicy());
      verdict = evaluate(p.action, {
        ...this.baseCtx(m, "execute", true, data.markets[p.action.symbol]?.mark_price ?? null, (data.account?.positions ?? []).map((x) => ({ symbol: x.symbol, size: x.size, markPrice: data.markets[x.symbol]?.mark_price ?? "0", marginMode: x.margin_mode })), {
          mark: data.now - data.marketsFetchedAt, depth: data.depthFetchedAt === null ? null : data.now - data.depthFetchedAt, account: data.account ? data.now - data.account.fetchedAt : 0,
        }),
        refPrice: report.entryPrice.value,
        liquidation: report.liquidation.distancePct.value ? { kind: "value", pct: report.liquidation.distancePct.value } : report.liquidation.price.value === "0 (none)" ? { kind: "none" } : { kind: "unavailable", reason: report.liquidation.basis },
      }, this.getPolicy());
      freshMark = data.markets[p.action.symbol]?.mark_price ?? null;
      if (data.depth) depth = { data: data.depth, fetchedAt: data.depthFetchedAt ?? this.now(), url: "" };
    } else if (p.action.kind === "cancel") {
      verdict = evaluate(p.action, this.baseCtx(m, "execute", true, null, [], {}), this.getPolicy());
    } else {
      views = await this.positionViews(p.source);
      const t = this.now();
      if (p.action.kind === "partial_close") depth = await getDepth(this.client, p.action.symbol).catch(() => null);
      freshMark = views.markets[p.action.symbol]?.mark_price ?? null;
      verdict = evaluate(p.action, this.baseCtx(m, "execute", true, freshMark, views.positions.map((x) => ({ symbol: x.symbol, size: x.size, markPrice: views!.markets[x.symbol]?.mark_price ?? "0", marginMode: x.margin_mode })), {
        mark: t - views.marketsFetchedAt, depth: depth ? t - depth.fetchedAt : null, account: t - views.fetchedAt,
      }), this.getPolicy());
    }
    if (verdict.decision !== "APPROVE") return fail("blocked_by_referee", verdict.violations.map((v) => `${v.id}: ${v.message}`), verdict);

    const ts = new Date(this.now()).toISOString();
    let status: string;
    let details: unknown;
    try {
      if (p.mode === "paper") ({ status, details } = await this.executePaper(p.action, p.leverage ?? 1, depth?.data ?? null, ts));
      else ({ status, details } = await this.executeLive(p.action, views));
    } catch (e) {
      if (e instanceof PaperError) return fail("paper_rejected", e.message, verdict);
      const ent = this.log.append("execution_error", p.mode, { proposalId: id, error: String(e) });
      this.saveProposal({ ...p, status: "rejected" });
      return { proposalId: id, mode: p.mode, status: "error", label: p.mode === "live" ? "LIVE" : "PAPER", details: String(e), verdict, logSeq: ent.seq };
    }
    this.saveProposal({ ...p, status: "executed" });
    const e: LogEntry = this.log.append("execution", p.mode, { proposalId: id, action: p.action, status, details, reduction: isReduction(p.action) });
    return { proposalId: id, mode: p.mode, status, label: p.mode === "live" ? "LIVE" : "PAPER", details, verdict, logSeq: e.seq };
  }

  private async executePaper(a: Action, leverage: number, depth: import("./schemas.js").Depth | null, ts: string): Promise<{ status: string; details: unknown }> {
    let s = this.paper();
    const taker = await this.takerRate();
    if (a.kind === "open" || a.kind === "partial_close") {
      if (a.kind === "open" && a.orderType === "limit") throw new PaperError("PAPER: limit orders are not simulated; use a market order");
      if (!depth) throw new PaperError("PAPER: no fresh order book to simulate the fill");
      const w = walkDepth(depth, a.side, dec(a.size));
      if (w.insufficient || !w.avgPrice) throw new PaperError("PAPER: order book cannot fill this size");
      const px = w.avgPrice.toSignificantDigits(12).toString();
      s = a.kind === "open" ? paperOpen(s, a.symbol, a.side, a.size, px, leverage, taker, ts) : paperClose(s, a.symbol, a.side, a.size, px, taker, ts, "reduce-only market close");
      savePaper(this.files.paper, s);
      return { status: "filled (PAPER)", details: { avgFill: px, levelsUsed: w.levelsUsed, fill: s.fills.at(-1), walletBalance: s.walletBalance } };
    }
    if (a.kind === "protective_stop") {
      const order = { id: `paper-${randomUUID()}`, symbol: a.symbol, side: a.side, type: "stop" as const, size: a.size, stopPrice: a.stopPrice, reduceOnly: true as const, status: "resting" as const, createdAt: ts };
      s = paperAddStop(s, order);
      savePaper(this.files.paper, s);
      return { status: "resting (PAPER simulated stop)", details: order };
    }
    if (a.kind === "iso_margin_add") {
      s = paperIsoAdd(s, a.symbol, a.amount);
      savePaper(this.files.paper, s);
      return { status: "applied (PAPER)", details: { symbol: a.symbol, amount: a.amount, iso_balance: s.positions.find((x) => x.symbol === a.symbol)?.iso_balance } };
    }
    s = paperCancel(s, a.orderId);
    savePaper(this.files.paper, s);
    return { status: "canceled (PAPER)", details: { orderId: a.orderId } };
  }

  /** LIVE path: exactly one request per action, then reconcile from Strike (no retries). */
  private async executeLive(a: Action, views: Awaited<ReturnType<Apex["positionViews"]>> | null): Promise<{ status: string; details: unknown }> {
    if (a.kind === "open") throw new Error("LIVE opens are out of scope for Apex (CLAUDE.md §5 P0.4): use PAPER, or open on Strike directly");
    if (a.kind === "protective_stop" || a.kind === "partial_close") {
      const clientOrderId = `apex-${randomUUID()}`;
      const body = a.kind === "protective_stop"
        ? { client_order_id: clientOrderId, symbol: a.symbol, side: a.side, type: "stop" as const, size: a.size, stop_price: a.stopPrice, reduce_only: true as const }
        : { client_order_id: clientOrderId, symbol: a.symbol, side: a.side, type: "market" as const, size: a.size, reduce_only: true as const, slippage: a.slippage };
      const sent = await placeOrder(this.client, body);
      this.log.append("live_order_sent", "live", { body, response: sent.data });
      const rec = await reconcileOrder(this.client, a.symbol, clientOrderId, { timeoutMs: RECONCILE_TIMEOUT_MS, now: this.now });
      return { status: `${rec.status} (Strike)`, details: { clientOrderId, sent: sent.data, reconciled: rec } };
    }
    if (a.kind === "iso_margin_add") {
      const before = views?.positions.find((x) => x.symbol === a.symbol)?.iso_balance ?? "0";
      const sent = await addIsoMargin(this.client, a.symbol, a.amount);
      this.log.append("live_iso_margin_sent", "live", { symbol: a.symbol, amount: a.amount, response: sent.data });
      const rec = await reconcileIsoMargin(this.client, a.symbol, before, { timeoutMs: RECONCILE_TIMEOUT_MS, now: this.now });
      return { status: `${rec.status} (Strike)`, details: { sent: sent.data, reconciled: rec, isoBefore: before } };
    }
    const orderId = Number(a.orderId);
    if (!Number.isSafeInteger(orderId)) throw new Error("order_id must be an integer engine order ID");
    const sent = await cancelOrder(this.client, a.symbol, orderId);
    return { status: "cancel sequenced (Strike)", details: sent.data };
  }

  // ── fair value (P1) ────────────────────────────────────────────────────────
  async fairValue(symbol: string): Promise<FairValue> {
    const ms = await this.markets();
    const m = ms.find((x) => x.symbol === symbol);
    if (!m) throw new Error("Unknown symbol " + symbol);
    const ref = referenceFor(symbol, m.class);
    const refM = ref ? ms.find((x) => x.symbol === ref) : undefined;
    const [k, refK] = await Promise.all([
      loadMarkHistory(this.client, symbol, 3, this.now()),
      ref ? loadMarkHistory(this.client, ref, 3, this.now()) : Promise.resolve([]),
    ]);
    return fairValue(symbol, m.class, m.session, m.stats.markPrice, refM?.stats.markPrice ?? null, k, refK, this.now());
  }

  // ── Mandate Vault (P2, PAPER) ─────────────────────────────────────────────
  private vaultLedger(): PaperState {
    const s = loadPaper(this.files.vaultPaper);
    return existsSync(this.files.vaultPaper) ? s : { ...s, walletBalance: MANDATE.startingEquityUsd };
  }

  private vaultState(): VaultState {
    return existsSync(this.files.vaultState) ? (JSON.parse(readFileSync(this.files.vaultState, "utf8")) as VaultState) : initialVaultState(MANDATE);
  }

  private async vaultEquity(s: PaperState) {
    const { markets } = await this.marketsInfo();
    let upnl = new D(0);
    for (const p of s.positions) {
      const m = markets[p.symbol];
      if (m) upnl = upnl.add(dec(m.mark_price).sub(dec(p.entry_price)).mul(dec(p.size)));
    }
    return { equity: dec(s.walletBalance).add(upnl), upnl, markets };
  }

  async vaultStatus() {
    const s = this.vaultLedger();
    const st = this.vaultState();
    const { equity, upnl } = await this.vaultEquity(s);
    const peak = D.max(dec(st.peakEquity), equity);
    return {
      label: "PAPER",
      mandate: MANDATE,
      equityUsd: equity.toFixed(2),
      startingEquityUsd: MANDATE.startingEquityUsd,
      returnPct: equity.div(dec(MANDATE.startingEquityUsd)).sub(1).mul(100).toFixed(2),
      unrealizedPnlUsd: upnl.toFixed(2),
      peakEquityUsd: peak.toFixed(2),
      drawdownPct: drawdownPct(equity, peak).toFixed(2),
      positions: s.positions,
      fills: s.fills.slice(-20),
      actionsToday: st.actions.filter((t) => Date.parse(t) > this.now() - 86_400_000).length,
      note: "PAPER vault: simulated fills on live Strike prices. No real vault is traded.",
    };
  }

  vaultDecisions(limit = 50): LogEntry[] {
    return this.log.entries().filter((e) => e.type === "vault_decision").slice(-limit).reverse();
  }

  /** One mandate evaluation: emergency rule, flat-before-open rule, then reversion signals per allowed symbol. */
  async vaultTick() {
    const policy = mandatePolicy(MANDATE);
    let s = this.vaultLedger();
    const st = this.vaultState();
    const decisions: Array<{ symbol: string; outcome: string; reasoning: string; checks?: string[] }> = [];
    const ts = new Date(this.now()).toISOString();
    const taker = await this.takerRate();
    const ms = await this.markets();
    const record = (d: { symbol: string; outcome: string; reasoning: string; checks?: string[]; inputs?: unknown }) => {
      decisions.push(d);
      this.log.append("vault_decision", "paper", { mandate: MANDATE.name, ...d });
    };
    const closeAt = async (symbol: string, why: string) => {
      const p = s.positions.find((x) => x.symbol === symbol);
      if (!p) return;
      const side = dec(p.size).isPos() ? "sell" : "buy";
      const depth = await getDepth(this.client, symbol).catch(() => null);
      const w = depth ? walkDepth(depth.data, side, dec(p.size).abs()) : null;
      if (!w?.avgPrice || w.insufficient) {
        record({ symbol, outcome: "close_failed", reasoning: why + "; order book cannot fill the close (PAPER), will retry next tick" });
        return;
      }
      s = paperClose(s, symbol, side, dec(p.size).abs().toString(), w.avgPrice.toSignificantDigits(12).toString(), taker, ts, why);
      st.actions.push(ts);
      record({ symbol, outcome: "closed", reasoning: why + "; filled " + dec(p.size).abs().toString() + " at " + w.avgPrice.toSignificantDigits(10).toString() + " (PAPER)" });
    };

    // Emergency rule: flatten everything if drawdown exceeds the mandate's limit.
    let { equity } = await this.vaultEquity(s);
    const peak = D.max(dec(st.peakEquity), equity);
    const dd = drawdownPct(equity, peak);
    if (dd.gt(dec(MANDATE.emergency.flattenAllIfDrawdownPctAbove))) {
      for (const p of [...s.positions]) await closeAt(p.symbol, "EMERGENCY: drawdown " + dd.toFixed(2) + "% > " + MANDATE.emergency.flattenAllIfDrawdownPctAbove + "%");
    }

    // Flat before the next underlying open.
    for (const p of [...s.positions]) {
      const m = ms.find((x) => x.symbol === p.symbol);
      const mins = m?.sessionState.nextOpen ? (m.sessionState.nextOpen - this.now()) / 60_000 : null;
      if (!m || m.sessionState.underlying !== "closed" || (mins !== null && mins <= MANDATE.weekend.flatMinutesBeforeOpen)) {
        await closeAt(p.symbol, "Mandate: flat before the underlying open (" + (m?.sessionState.underlying ?? "unknown") + (mins !== null ? ", opens in " + mins.toFixed(0) + " min" : "") + ")");
      }
    }

    // Signals.
    const actionsToday = st.actions.filter((t) => Date.parse(t) > this.now() - 86_400_000).length;
    for (const symbol of MANDATE.allowedSymbols) {
      if (s.positions.some((p) => p.symbol === symbol)) continue;
      const m = ms.find((x) => x.symbol === symbol);
      if (!m) {
        record({ symbol, outcome: "skip", reasoning: "symbol not listed on Strike" });
        continue;
      }
      const fv = await this.fairValue(symbol).catch(() => null);
      const sig = reversionSignal({
        symbol, underlying: m.sessionState.underlying, minutesToOpen: m.sessionState.nextOpen ? (m.sessionState.nextOpen - this.now()) / 60_000 : null,
        fvStatus: fv?.status ?? "ERROR", implied: fv?.implied ?? null, halfWidthPct: fv?.bandHalfWidthPct ?? null, mark: m.stats.markPrice,
      }, MANDATE);
      if (sig.kind === "none") {
        record({ symbol, outcome: "no_signal", reasoning: "No trade: " + sig.reason + ".", inputs: { mark: m.stats.markPrice, fairValue: fv ? { status: fv.status, implied: fv.implied, halfWidthPct: fv.bandHalfWidthPct } : null } });
        continue;
      }
      if (actionsToday + decisions.filter((d) => d.outcome === "opened" || d.outcome === "closed").length >= MANDATE.maxActionsPerDay) {
        record({ symbol, outcome: "skip", reasoning: "Signal (" + sig.reason + ") but the mandate's " + MANDATE.maxActionsPerDay + " actions/day limit is reached." });
        continue;
      }
      const account = { source: "PAPER" as const, walletBalance: s.walletBalance, positions: s.positions, marginModeFor: () => "isolated" as const, fetchedAt: this.now() };
      const data = await loadCircuitData(this.client, this.registry, symbol, { mode: "paper", liveEnvEnabled: false, account: { ...account, fetchedAt: this.now() }, actionsInLastHour: 0, now: this.now });
      const r = runCircuit({ symbol, side: sig.side, notionalUsd: MANDATE.maxPositionNotionalUsd, leverage: MANDATE.maxLeverage, orderType: "market" }, data, policy);
      const checks = r.verdict.checks.map((c) => c.id + " " + c.status + ": " + c.message);
      if (r.verdict.decision !== "APPROVE" || !data.depth || !r.entryPrice.value) {
        record({ symbol, outcome: "blocked", reasoning: "Signal: " + sig.reason + ". Referee BLOCK: " + r.verdict.violations.map((v) => v.id + " " + v.message).join("; ") + ".", checks });
        continue;
      }
      s = paperOpen(s, symbol, sig.side, r.size.value!, r.entryPrice.value, MANDATE.maxLeverage, taker, ts);
      st.actions.push(ts);
      record({
        symbol, outcome: "opened", checks,
        reasoning: "Signal: " + sig.reason + ". Circuit: " + sig.side + " " + r.size.value + " at ≈ " + r.entryPrice.value + " (" + MANDATE.maxLeverage + "x, $" + r.notionalUsd.value + "), liquidation " + r.liquidation.distancePct.value + "% away. Referee APPROVE. Filled (PAPER); will be closed before the underlying opens.",
      });
    }
    savePaper(this.files.vaultPaper, s);
    ({ equity } = await this.vaultEquity(s));
    st.peakEquity = D.max(dec(st.peakEquity), equity).toString();
    st.actions = st.actions.filter((t) => Date.parse(t) > this.now() - 7 * 86_400_000);
    writeFileSync(this.files.vaultState, JSON.stringify(st, null, 2));
    return { label: "PAPER", ts, decisions, status: await this.vaultStatus() };
  }

  // ── credit (P1) ────────────────────────────────────────────────────────────
  /**
   * Credit Line Copilot inputs. Line values q, D, s are USER-ENTERED (no per-user credit endpoint,
   * VERIFICATION #13); collateral price P and SLP share price S are read live.
   */
  async creditInputs(asset: string, vaultId?: string) {
    const [settings, assets] = await Promise.all([getCreditSettings(this.client), getCollateralAssets(this.client)]);
    const st = settings.data.settings.collateral_assets[asset];
    const a = assets.data.assets[asset];
    if (!st || !a) throw new Error("Unknown collateral asset " + asset + ". Supported: " + Object.keys(settings.data.settings.collateral_assets).join(", "));
    if (!a.price_available || !a.price) throw new Error("No usable price published for " + asset + " (price_available=false)");
    const approved = settings.data.settings.approved_vaults;
    const vid = vaultId ?? Object.keys(approved).find((k) => approved[k]);
    if (!vid) throw new Error("No approved credit vault in /v2/credit/settings");
    const vault = await getVault(this.client, vid);
    return {
      params: paramsFrom(st, CREDIT_SHARED),
      price: a.price,
      priceFresh: a.price_fresh && this.now() < a.price_expires_at,
      sharePrice: vault.data.share_price,
      vault: { id: vid, name: vault.data.name },
    };
  }

  async creditLineHealth(input: { asset: string; collateralUnits: string; debtUsd: string; encumberedShares: string; vaultId?: string }) {
    const i = await this.creditInputs(input.asset, input.vaultId);
    const q = dec(input.collateralUnits), Dt = dec(input.debtUsd), s = dec(input.encumberedShares);
    const P = dec(i.price), S = dec(i.sharePrice);
    const C = q.mul(P), V = s.mul(S);
    const h = health(C, V, Dt, i.params);
    const t = completionTargets(i.params);
    const b = boundaryPrice(q, V, Dt, i.params);
    const fix = fixAmounts(q, P, V, Dt, i.params);
    const f = (x: ReturnType<typeof dec>, dp = 6) => x.toDecimalPlaces(dp).toString();
    const out = {
      label: "ESTIMATE",
      inputs: { ...input, label: "USER-ENTERED line values (Strike exposes no per-user credit-line endpoint)" },
      live: { collateralPrice: i.price, priceFresh: i.priceFresh, sharePrice: i.sharePrice, vault: i.vault, label: "LIVE", basis: "GET /v2/credit/collateral-assets, GET /v2/vault/:id" },
      params: { M: i.params.M.toString(), X: i.params.X.toString(), d: i.params.d.toString(), Y: i.params.Y.toString(), F: i.params.F.toString(), r: i.params.r.toString(), basis: "M, X, d from /v2/credit/settings; Y, F, r from the Borrow-and-Earn doc (config/credit.ts)" },
      values: { collateralValueUsd: f(C, 2), vaultValueUsd: f(V, 2), c: f(h.c), v: f(h.v), J: f(h.J) },
      health: { credit: h.creditHealth.toFixed(2), joint: h.jointHealth.toFixed(2), floor: h.floorHealth.toFixed(2), state: h.state, note: "Score points, not percentages; 100 = recovery boundary" },
      targets: { Jstar: f(t.Jstar), Fstar: f(t.Fstar), jointHealthTarget: t.jointHealthTarget.toFixed(2), floorHealthTarget: t.floorHealthTarget.toFixed(2) },
      recoveryBoundary: { collateralPrice: f(b.price), binds: b.binds, distancePct: P.gt(0) ? P.sub(b.price).div(P).mul(100).toFixed(2) : null, conversionPriceNow: f(conversionPrice(P, i.params)) },
      fixToCompletionTargets: { alreadyMeets: fix.alreadyMeets, repayUsd: fix.repayUsd.toFixed(2), orAddCollateralUnits: fix.addCollateralUnits.toString() },
      warnings: i.priceFresh ? [] : ["STALE: collateral price is not fresh (price_fresh=false or expired); numbers shown, do not act on them"],
    };
    this.log.append("credit_health", "scenario", { inputs: out.inputs, health: out.health, values: out.values });
    return out;
  }

  async creditStressGrid(input: { asset: string; collateralUnits: string; debtUsd: string; encumberedShares: string; vaultId?: string }) {
    const i = await this.creditInputs(input.asset, input.vaultId);
    const grid = stressGrid(dec(input.collateralUnits), dec(i.price), dec(input.encumberedShares), dec(i.sharePrice), dec(input.debtUsd), i.params);
    return { label: "SCENARIO", rowsAreVaultDrawdownPct: [0, -5, -10, -15, -20, -25, -30], colsAreCollateralChangePct: [0, -5, -10, -15, -20, -25, -30, -35, -40, -45, -50], grid, live: { collateralPrice: i.price, sharePrice: i.sharePrice, priceFresh: i.priceFresh } };
  }

  // ── log ────────────────────────────────────────────────────────────────────
  decisionLog(limit = 50): LogEntry[] {
    return this.log.entries().slice(-limit);
  }

  verifyLog() {
    return { ...verifyLog(this.files.log, this.log.publicKeyHex), publicKey: this.log.publicKeyHex, file: this.files.log };
  }

  /** Liquidation validation helper (CLAUDE.md §6.5) for the chosen LIVE source. */
  async validateLiquidations(source: "own" | "vault" = this.hasKeys ? "own" : "vault") {
    const v = await this.positionViews(source);
    const mm = Object.fromEntries(Object.entries(v.markets).map(([k, m]) => [k, { tiers: m.margin_tiers, quotePrec: m.quote_prec, mark: m.mark_price }]));
    const { compareLiquidations } = await import("./margin.js");
    return compareLiquidations(accountLiquidations(v.positions, mm, dec(v.walletBalance ?? "0")), v.positions);
  }
}

