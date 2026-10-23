// Weekend risk report: per-market closed-session stats and per-position gap risk + protections.
import { type CircuitData, estimateLiquidation } from "./circuit.js";
import type { StrikeClient } from "./http.js";
import { D, type Dec, dec, floorToStep, roundToTick } from "./money.js";
import { getDepth, getKlines } from "./market.js";
import type { Policy } from "./policy.js";
import { type Action, type RefereeContext, type Verdict, evaluate } from "./referee.js";
import type { MarketRecord } from "./registry.js";
import type { Depth, Kline } from "./schemas.js";
import {
  type Band, type Flag, type GapDistribution, band, distanceForLowBand, flagsFor, gapDistribution, isoMarginAddFor, pGap, protectiveStopPrice,
} from "./shield.js";

const HOUR = 3600_000;

// ── data ─────────────────────────────────────────────────────────────────────

const klineCache = new Map<string, { at: number; rows: Kline[] }>();

/** 1h mark klines, paginated backwards (≤1500 rows per call, CLAUDE.md §4.3), cached 10 min. */
const klineInflight = new Map<string, Promise<Kline[]>>();

/** Concurrent callers for the same symbol share one fetch (a cold serverless instance gets many parallel requests). */
export function loadMarkHistory(client: StrikeClient, symbol: string, maxPages = 3, now = Date.now()): Promise<Kline[]> {
  const hit = klineCache.get(symbol);
  if (hit && now - hit.at < 600_000) return Promise.resolve(hit.rows);
  let p = klineInflight.get(symbol);
  if (!p) {
    p = fetchMarkHistory(client, symbol, maxPages, now).finally(() => klineInflight.delete(symbol));
    klineInflight.set(symbol, p);
  }
  return p;
}

async function fetchMarkHistory(client: StrikeClient, symbol: string, maxPages: number, now: number): Promise<Kline[]> {
  let rows: Kline[] = [];
  let endTime: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await getKlines(client, { symbol, interval: "1h", priceType: "mark", limit: 1500, ...(endTime ? { endTime } : {}) });
    const fresh = res.data.filter((r) => !rows.some((x) => x.openTime === r.openTime));
    rows = [...fresh, ...rows];
    if (res.data.length < 1500 || !res.data[0]) break;
    endTime = res.data[0].openTime - 1;
  }
  rows.sort((a, b) => a.openTime - b.openTime);
  klineCache.set(symbol, { at: now, rows });
  return rows;
}

// ── market-level stats ───────────────────────────────────────────────────────

export interface MarketGapStats {
  symbol: string;
  class: string;
  underlying: string;
  nextOpen: number | null;
  hoursUntilNextOpen: string | null;
  windowHours: string | null;
  method: string;
  samples: number;
  sigmaHourlyPct: string | null;
  worstAdverseLongPct: string | null;
  worstAdverseShortPct: string | null;
  pMove5Long: string | null;
  pMove10Long: string | null;
  flags: Flag[];
  notes: string[];
  label: "ESTIMATE";
  basis: string;
}

const pct = (x: number | null, dp = 2) => (x === null ? null : (x * 100).toFixed(dp));

export function marketGapStats(m: MarketRecord, klines: Kline[], depth: Depth | null, now: number): { stats: MarketGapStats; dist: GapDistribution } {
  const dist = gapDistribution(m.session, klines, now);
  const st = m.sessionState;
  const mark = dec(m.stats.markPrice);
  const flags = flagsFor(m.session, m.class === "crypto", klines, depth, mark);
  const r = dist.returns;
  return {
    dist,
    stats: {
      symbol: m.symbol,
      class: m.class,
      underlying: st.underlying,
      nextOpen: st.nextOpen,
      hoursUntilNextOpen: st.underlying === "closed" && st.nextOpen ? ((st.nextOpen - now) / HOUR).toFixed(1) : null,
      windowHours: dist.windowHours === null ? null : dist.windowHours.toFixed(1),
      method: dist.method,
      samples: dist.samples,
      sigmaHourlyPct: pct(dist.sigmaHourly, 3),
      worstAdverseLongPct: r.length ? pct(Math.min(...r)) : null,
      worstAdverseShortPct: r.length ? pct(Math.max(...r)) : null,
      pMove5Long: pct(pGap(dist, "long", 0.05), 1),
      pMove10Long: pct(pGap(dist, "long", 0.1), 1),
      flags,
      notes: [dist.note, ...m.notes],
      label: "ESTIMATE",
      basis: `GET /price/v2/klines 1h mark (${klines.length} rows), session map: ${m.sessionSource}`,
    },
  };
}

// ── position-level report ────────────────────────────────────────────────────

export interface PositionInputView {
  symbol: string;
  size: string;
  entry_price: string;
  leverage: number;
  margin_mode: "cross" | "isolated";
  iso_balance: string;
  /** Strike's own liquidation_price (LIVE) or Apex's computed one (PAPER). "0" = none. */
  liquidation_price: string;
}

export interface Suggestion {
  kind: "protective_stop" | "partial_close" | "iso_margin_add";
  action: Action;
  summary: string;
  after: { liquidationPrice: string | null; distancePct: string | null; pGapPct: string | null; band: Band; label: "ESTIMATE" };
  verdict: Verdict;
}

export interface PositionGapRisk {
  symbol: string;
  side: "long" | "short";
  size: string;
  markPrice: string;
  liquidationPrice: string;
  liquidationDistancePct: string | null;
  underlying: string;
  pGapPct: string | null;
  band: Band;
  method: string;
  samples: number;
  flags: Flag[];
  notes: string[];
  suggestions: Suggestion[];
  label: string;
}

export interface ShieldContext {
  policy: Policy;
  /** Circuit data (markets, account, filters) for re-estimating liquidation after a proposal. */
  circuitData: CircuitData;
  registry: (symbol: string) => MarketRecord | undefined;
  dist: (symbol: string) => GapDistribution;
  flags: (symbol: string) => Flag[];
  positionsLabel: string;
}

function refCtx(sc: ShieldContext, m: MarketRecord, positions: PositionInputView[]): RefereeContext {
  const d = sc.circuitData;
  return {
    stage: "propose",
    mode: d.mode,
    liveEnvEnabled: d.liveEnvEnabled,
    humanConfirmed: false,
    market: { symbol: m.symbol, class: m.class, perpStatus: m.perpStatus, underlying: m.sessionState.underlying, filters: m.filters },
    markPrice: d.markets[m.symbol]?.mark_price ?? null,
    dataAgesMs: {
      mark: d.now - d.marketsFetchedAt,
      depth: d.depthFetchedAt === null ? null : d.now - d.depthFetchedAt,
      account: d.account ? d.now - d.account.fetchedAt : null,
    },
    portfolio: positions.map((p) => ({ symbol: p.symbol, size: p.size, markPrice: d.markets[p.symbol]?.mark_price ?? "0", marginMode: p.margin_mode })),
    liquidation: { kind: "none" },
    actionsInLastHour: d.actionsInLastHour,
  };
}

function afterNumbers(lp: Dec | null, mark: Dec, side: "long" | "short", dist: GapDistribution): Suggestion["after"] {
  if (lp === null) return { liquidationPrice: null, distancePct: null, pGapPct: null, band: "N/A", label: "ESTIMATE" };
  if (lp.isZero()) return { liquidationPrice: "0", distancePct: null, pGapPct: "0.0", band: "LOW", label: "ESTIMATE" };
  const d = lp.sub(mark).abs().div(mark).toNumber();
  const p = pGap(dist, side, d);
  return { liquidationPrice: lp.toSignificantDigits(10).toString(), distancePct: (d * 100).toFixed(2), pGapPct: p === null ? null : (p * 100).toFixed(1), band: band(p), label: "ESTIMATE" };
}

/** `force` builds proposals even for a LOW band (user explicitly asked to protect a position). */
export function positionGapRisk(p: PositionInputView, positions: PositionInputView[], sc: ShieldContext, force = false): PositionGapRisk {
  const m = sc.registry(p.symbol);
  const size = dec(p.size);
  const side = size.isPos() ? "long" : "short";
  const info = sc.circuitData.markets[p.symbol];
  const mark = info ? dec(info.mark_price) : m ? dec(m.stats.markPrice) : null;
  const liq = dec(p.liquidation_price);
  const base: Omit<PositionGapRisk, "pGapPct" | "band" | "method" | "samples" | "suggestions" | "liquidationDistancePct"> = {
    symbol: p.symbol, side, size: p.size, markPrice: mark?.toString() ?? "unknown", liquidationPrice: p.liquidation_price,
    underlying: m?.sessionState.underlying ?? "unknown", flags: sc.flags(p.symbol), notes: m?.notes ?? ["UNKNOWN_SYMBOL"], label: sc.positionsLabel,
  };
  if (!m || !mark) return { ...base, liquidationDistancePct: null, pGapPct: null, band: "N/A", method: "N/A", samples: 0, suggestions: [] };
  const dist = sc.dist(p.symbol);
  const dNum = liq.isZero() ? null : liq.sub(mark).abs().div(mark).toNumber();
  const p0 = dNum === null ? (dist.method === "N/A" ? null : 0) : pGap(dist, side, dNum);
  const b = band(p0);
  const out: PositionGapRisk = {
    ...base,
    liquidationDistancePct: dNum === null ? null : (dNum * 100).toFixed(2),
    pGapPct: p0 === null ? null : (p0 * 100).toFixed(1),
    band: b,
    method: dist.method,
    samples: dist.samples,
    suggestions: [],
  };
  if (!force && b !== "MEDIUM" && b !== "HIGH") return out;

  const ctx = refCtx(sc, m, positions);
  const f = m.filters;
  const closeSide = side === "long" ? "sell" : "buy";
  const minDist = dec(sc.policy.minLiquidationDistancePct);

  // (a) protective reduce-only stop.
  if (f) {
    // No liquidation price (well-collateralized): fall back to a stop minLiquidationDistancePct from mark.
    const sp = liq.isZero()
      ? roundToTick(side === "long" ? mark.mul(new D(1).sub(minDist.div(100))) : mark.mul(new D(1).add(minDist.div(100))), dec(f.tickSize), side === "long" ? "down" : "up")
      : protectiveStopPrice(side, mark, liq, minDist, dec(f.tickSize));
    if (sp) {
      const stepped = floorToStep(size.abs(), dec(f.stepSize));
      const action: Action = { kind: "protective_stop", symbol: p.symbol, side: closeSide, size: stepped.toString(), stopPrice: sp.toString(), reduceOnly: true };
      const lossAtStop = sp.sub(dec(p.entry_price)).mul(size);
      out.suggestions.push({
        kind: "protective_stop", action,
        summary: `Reduce-only ${closeSide} stop for ${stepped} at ${sp} (mark ${mark.toSignificantDigits(8)}, liquidation ${liq.toSignificantDigits(8)}); PnL at stop ≈ $${lossAtStop.toFixed(2)} before fees. A stop does not protect against a gap through it.`,
        after: { ...afterNumbers(liq, mark, side, dist), label: "ESTIMATE" },
        verdict: evaluate(action, ctx, sc.policy),
      });
    }
  }

  // (b) partial reduce-only close (cross: shrinking the position moves the cross LP away).
  if (f && p.margin_mode === "cross" && sc.circuitData.account) {
    const step = dec(f.marketStepSize);
    for (let frac = 10; frac <= 100; frac += 10) {
      const qty = floorToStep(size.abs().mul(frac).div(100), step);
      if (qty.isZero()) continue;
      const r = estimateLiquidation(sc.circuitData, p.symbol, side === "long" ? qty.neg() : qty, mark, p.leverage);
      if ("error" in r) break;
      const after = afterNumbers(r.lp, mark, side, dist);
      if (after.band === "LOW" || frac === 100) {
        const action: Action = { kind: "partial_close", symbol: p.symbol, side: closeSide, size: qty.toString(), reduceOnly: true, slippage: "0.01" };
        out.suggestions.push({ kind: "partial_close", action, summary: `Reduce-only market ${closeSide} of ${qty} (${frac}% of the position)`, after, verdict: evaluate(action, ctx, sc.policy) });
        break;
      }
    }
  }

  // (c) isolated margin add to restore the target distance.
  if (p.margin_mode === "isolated" && info && f) {
    const lowD = distanceForLowBand(dist, side);
    const target = D.max(minDist.div(100), lowD === null ? 0 : lowD + 0.0025);
    const targetLp = side === "long" ? mark.mul(new D(1).sub(target)) : mark.mul(new D(1).add(target));
    const amount = isoMarginAddFor(size, dec(p.entry_price), mark, p.leverage, dec(p.iso_balance), targetLp, info.margin_tiers, info.quote_prec);
    if (amount.gt(0)) {
      const action: Action = { kind: "iso_margin_add", symbol: p.symbol, amount: amount.toFixed(2) };
      out.suggestions.push({
        kind: "iso_margin_add", action,
        summary: `Add $${amount.toFixed(2)} isolated margin to move liquidation to ≈ ${targetLp.toSignificantDigits(8)} (${target.mul(100).toFixed(2)}% away)`,
        after: afterNumbers(targetLp, mark, side, dist),
        verdict: evaluate(action, ctx, sc.policy),
      });
    }
  }
  return out;
}

export async function loadDepthSafe(client: StrikeClient, symbol: string): Promise<Depth | null> {
  return getDepth(client, symbol).then((r) => r.data, () => null);
}

export type { GapDistribution };
