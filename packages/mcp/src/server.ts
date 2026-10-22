// Apex MCP server (CLAUDE.md §7). Tool API: @modelcontextprotocol/sdk v1 McpServer.registerTool.
// Every result: a one-paragraph plain-English summary + the JSON payload (with `mode` and labels).
import type { Apex, CircuitReport, PositionSource } from "@apex/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const DISCLAIMER = "Numbers are estimates from live Strike data, not guarantees. Apex does not give financial advice.";
const decStr = z.string().regex(/^\d+(\.\d+)?$/, "decimal string, e.g. \"1000\" or \"0.5\"");
const source = z.enum(["own", "paper", "vault"]).optional()
  .describe("Whose positions: own (your Strike account, needs API keys), paper (Apex paper account), vault (a Strike vault, public read-only). Default: own if keys are configured, else paper.");

type Content = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function reply(summary: string, data: unknown): Content {
  return { content: [{ type: "text", text: summary }, { type: "text", text: JSON.stringify(data, null, 1) }] };
}

function wrap<A>(fn: (args: A) => Promise<Content>) {
  return async (args: A): Promise<Content> => {
    try {
      return await fn(args);
    } catch (e) {
      // Fail closed: surface the error, never fabricate a result. Never include secrets.
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Apex could not complete this request: ${msg}` }], isError: true };
    }
  };
}

const n = (x: { value: string | null; label: string } | undefined) => (x?.value == null ? "n/a" : `${x.value} [${x.label}]`);

export function circuitSummary(r: CircuitReport): string {
  const v = r.verdict;
  const head = `${r.mode.toUpperCase()} simulation — ${r.side} ${r.size.value} ${r.symbol} (${r.orderType}, ${r.leverage}x), notional $${r.notionalUsd.value}, est. entry ${r.entryPrice.value}, mark ${r.markPrice.value} [LIVE].`;
  const liq = `Liquidation ≈ ${r.liquidation.price.value} (${r.liquidation.distancePct.value ?? "n/a"}% away, ${r.liquidation.marginMode}; ${r.liquidation.basis}) [ESTIMATE].`;
  const cost = `Open fee ≈ $${r.fees.openCostUsd.value}, slippage ≈ ${r.slippage.slippageBpsVsMark.value ?? "n/a"} bps, funding ≈ $${r.funding.costPer24hUsd.value}/24h.`;
  const stress = `Stress: ${r.stress.map((s) => `${s.movePct}% → $${s.pnlUsd.value}${s.liquidated ? " (LIQUIDATED)" : ""}`).join(", ")} [SCENARIO].`;
  const verdict = v.decision === "APPROVE"
    ? "Referee: APPROVE."
    : `Referee: BLOCK — ${v.violations.map((x) => `${x.id} ${x.message}`).join("; ")}.`;
  const alt = r.alternativeReport
    ? ` Compliant alternative: ${r.alternativeReport.side} ${r.alternativeReport.size.value} at ${r.alternativeReport.leverage}x (≈ $${r.alternativeReport.notionalUsd.value}), liquidation ≈ ${r.alternativeReport.liquidation.distancePct.value}% away, referee ${r.alternativeReport.verdict.decision}.`
    : "";
  const stale = r.stale.stale ? ` STALE data: ${r.stale.reasons.join("; ")}.` : "";
  return `${head} ${liq} ${cost} ${stress} ${verdict}${alt}${stale} ${DISCLAIMER}`;
}

export function createServer(apex: Apex): McpServer {
  const server = new McpServer({ name: "apex", version: "1.0.0" });
  const src = (s: PositionSource | undefined) => s ?? apex.defaultSource();

  server.registerTool("list_markets", {
    title: "List Strike markets",
    description: `All Strike perpetual markets with class (crypto/equity/index/commodity), perp status, underlying session (open/closed/unknown), mark, hourly funding, open interest and 24h volume. Filters: class, openOnly. ${DISCLAIMER}`,
    inputSchema: { class: z.enum(["crypto", "equity", "index", "commodity", "fx"]).optional(), openOnly: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, wrap(async (a: { class?: "crypto" | "equity" | "index" | "commodity" | "fx"; openOnly?: boolean }) => {
    const ms = await apex.listMarkets(a);
    const rows = ms.map((m) => ({
      symbol: m.symbol, class: m.class, perpStatus: m.perpStatus, underlying: m.sessionState.underlying,
      nextOpen: m.sessionState.nextOpen ? new Date(m.sessionState.nextOpen).toISOString() : null,
      markPrice: m.stats.markPrice, fundingRateHourly: m.stats.fundingRateHourly, openInterestUsd: m.stats.openInterest, volume24hUsd: m.stats.volume24h, notes: m.notes,
    }));
    const closed = rows.filter((r) => r.underlying !== "open").map((r) => r.symbol);
    return reply(
      `${rows.length} Strike markets [LIVE]. Underlying closed or unknown: ${closed.length ? closed.join(", ") : "none"}. Classes come from Apex's cited session map where Strike labels a stock or index as "Crypto" (CATEGORY_MISMATCH note). ${DISCLAIMER}`,
      { mode: apex.mode, label: "LIVE", markets: rows },
    );
  }));

  server.registerTool("get_market", {
    title: "Get one market",
    description: `One Strike market: prices, funding, open interest, order-book summary, underlying session, closed-window gap statistics and flags (STALE_MARK, THIN_BOOK, UNDERLYING_UNKNOWN). Symbols are case-sensitive, e.g. NVDA-USD. ${DISCLAIMER}`,
    inputSchema: { symbol: z.string() },
    annotations: { readOnlyHint: true },
  }, wrap(async ({ symbol }: { symbol: string }) => {
    const r = await apex.getMarket(symbol);
    const m = r.market;
    return reply(
      `${symbol} [LIVE]: mark ${m.stats.markPrice}, index ${m.stats.indexPrice}, hourly funding ${m.stats.fundingRateHourly}, perp ${m.perpStatus}, underlying ${m.sessionState.underlying}. Gap stats: ${r.gap.method}, ${r.gap.samples} samples, P(≥5% adverse closed-window move for a long) ${r.gap.pMove5Long ?? "n/a"}% [ESTIMATE]. Flags: ${r.gap.flags.join(", ") || "none"}. ${DISCLAIMER}`,
      { mode: apex.mode, ...r },
    );
  }));

  server.registerTool("get_account_summary", {
    title: "Account summary",
    description: `Balances, margin and leverage settings for your Strike account (LIVE, needs API keys), the Apex paper account (PAPER), or a vault (public read-only). ${DISCLAIMER}`,
    inputSchema: { source },
    annotations: { readOnlyHint: true },
  }, wrap(async (a: { source?: PositionSource }) => {
    const s = await apex.accountSummary(src(a.source));
    return reply(`Account summary (${s.label}). ${DISCLAIMER}`, { mode: apex.mode, ...s });
  }));

  server.registerTool("get_positions", {
    title: "Positions with risk",
    description: `Open positions with liquidation distance and weekend gap-risk band (LOW/MEDIUM/HIGH), method and sample count. ${DISCLAIMER}`,
    inputSchema: { source },
    annotations: { readOnlyHint: true },
  }, wrap(async (a: { source?: PositionSource }) => {
    const r = await apex.positionsWithRisk(src(a.source));
    const risky = r.positions.filter((p) => p.band === "MEDIUM" || p.band === "HIGH");
    return reply(
      `${r.positions.length} position(s) (${r.label}). ${risky.length ? `Elevated gap risk: ${risky.map((p) => `${p.symbol} ${p.band} (p_gap ${p.pGapPct}%)`).join(", ")}.` : "No position has MEDIUM/HIGH gap risk."} ${DISCLAIMER}`,
      { mode: apex.mode, ...r },
    );
  }));

  server.registerTool("get_order_history", {
    title: "Order history",
    description: `Recent orders (and paper fills). ${DISCLAIMER}`,
    inputSchema: { source, symbol: z.string().optional() },
    annotations: { readOnlyHint: true },
  }, wrap(async (a: { source?: PositionSource; symbol?: string }) => {
    const r = await apex.orderHistory(src(a.source), a.symbol);
    return reply(`Order history (${r.label}): ${r.orders.length} order(s). ${DISCLAIMER}`, { mode: apex.mode, ...r });
  }));

  const tradeShape = {
    symbol: z.string().describe("e.g. NVDA-USD (case-sensitive)"),
    side: z.enum(["buy", "sell"]),
    notionalUsd: decStr.optional().describe("USD notional; give this or size"),
    size: decStr.optional().describe("Base-asset size; give this or notionalUsd"),
    leverage: z.number().int().min(1).max(100),
    orderType: z.enum(["market", "limit"]).default("market"),
    limitPrice: decStr.optional(),
    stopLoss: decStr.optional(),
    takeProfit: decStr.optional(),
    customMovePct: decStr.optional().describe("Extra adverse move for the stress table, percent"),
    source,
  };
  type TradeArgs = { symbol: string; side: "buy" | "sell"; notionalUsd?: string; size?: string; leverage: number; orderType: "market" | "limit"; limitPrice?: string; stopLoss?: string; takeProfit?: string; customMovePct?: string; source?: PositionSource };
  const toInput = (a: TradeArgs) => {
    if (!a.notionalUsd === !a.size) throw new Error("Give exactly one of notionalUsd or size");
    const { source: _s, ...rest } = a;
    void _s;
    return rest;
  };

  server.registerTool("simulate_trade", {
    title: "Circuit: simulate a trade",
    description: `Circuit pre-trade simulator: liquidation estimate (Strike margin-tier formulas), fees, order-book slippage, funding, portfolio impact, stress at 2/5/8% (+custom), risk/reward, weekend exposure, and the Risk Referee verdict with a compliant alternative when blocked. Sends nothing to Strike. ${DISCLAIMER}`,
    inputSchema: tradeShape,
    annotations: { readOnlyHint: true },
  }, wrap(async (a: TradeArgs) => {
    const r = await apex.simulateTrade(toInput(a), src(a.source));
    return reply(circuitSummary(r), r);
  }));

  server.registerTool("stress_test_position", {
    title: "Stress-test a position",
    description: `PnL and liquidation status of an existing position at custom adverse moves (percent). SCENARIO numbers. ${DISCLAIMER}`,
    inputSchema: { symbol: z.string(), movesPct: z.array(decStr).min(1).max(20).default(["2", "5", "8", "15"]), source },
    annotations: { readOnlyHint: true },
  }, wrap(async (a: { symbol: string; movesPct: string[]; source?: PositionSource }) => {
    const r = await apex.stressTestPosition(a.symbol, a.movesPct, src(a.source));
    return reply(`${a.symbol} stress (${r.label}, SCENARIO): ${r.rows.map((x) => `${x.adverseMovePct}% → $${x.unrealizedPnlUsd}${x.liquidated ? " LIQUIDATED" : ""}`).join(", ")}. ${r.note} ${DISCLAIMER}`, { mode: apex.mode, ...r });
  }));

  server.registerTool("weekend_risk_report", {
    title: "Weekend Shield report",
    description: `Weekend Shield: for every stock/index/commodity market, the underlying session, hours to next open, closed-window gap statistics (EMPIRICAL from Strike mark history, or MODELED) with sample counts and flags; for every position, p_gap (probability an adverse closed-session move reaches the liquidation distance), band and suggested protections. ${DISCLAIMER}`,
    inputSchema: { source },
    annotations: { readOnlyHint: true },
  }, wrap(async (a: { source?: PositionSource }) => {
    const r = await apex.weekendRiskReport(src(a.source));
    const risky = r.positions.filter((p) => p.band === "MEDIUM" || p.band === "HIGH");
    const closed = r.markets.filter((m) => m.underlying !== "open");
    const unknown = r.markets.filter((m) => m.underlying === "unknown").map((m) => m.symbol);
    return reply(
      `Weekend risk (${r.mode.toUpperCase()}, positions: ${r.positionsLabel}). ${closed.length}/${r.markets.length} non-crypto markets have a closed or unknown underlying session${unknown.length ? ` (unknown, scored conservatively: ${unknown.join(", ")})` : ""}. ` +
      `${r.positions.length} position(s): ${risky.length ? risky.map((p) => `${p.symbol} ${p.band} p_gap ${p.pGapPct}% (${p.method}, n=${p.samples}), ${p.suggestions.length} protection proposal(s)`).join("; ") : "none with MEDIUM/HIGH gap risk"}. ` +
      `Use propose_protection to turn a suggestion into an executable proposal. Logged as decision #${r.logSeq}. ${DISCLAIMER}`,
      r,
    );
  }));

  server.registerTool("propose_protection", {
    title: "Propose a protection",
    description: `Builds protection proposals for one position — a reduce-only protective stop, a reduce-only partial close (cross positions), or an isolated-margin add — each run through Circuit numbers and the Risk Referee. Stores proposals for 120 s; sends nothing to Strike. Execute with execute_proposal. ${DISCLAIMER}`,
    inputSchema: { symbol: z.string(), kind: z.enum(["protective_stop", "partial_close", "iso_margin_add"]).optional(), source },
  }, wrap(async (a: { symbol: string; kind?: "protective_stop" | "partial_close" | "iso_margin_add"; source?: PositionSource }) => {
    const r = await apex.proposeProtection(a.symbol, a.kind, src(a.source));
    const lines = r.proposals.map((p) => `[${p.id}] ${p.mode.toUpperCase()} ${p.summary} — referee ${p.verdict.decision}${p.verdict.violations.length ? ` (${p.verdict.violations.map((v) => v.id).join(", ")})` : ""}`);
    return reply(`${a.symbol} (${r.position.band}, p_gap ${r.position.pGapPct}%): ${lines.join(" | ") || r.note} ${r.proposals.length ? r.note : ""} ${DISCLAIMER}`, { mode: apex.mode, ...r });
  }));

  server.registerTool("propose_trade", {
    title: "Propose a trade",
    description: `Builds an open-trade proposal: full Circuit report plus Risk Referee verdict. Stores it for 120 s; sends nothing to Strike. LIVE opens are out of Apex's scope — trade proposals execute in PAPER. ${DISCLAIMER}`,
    inputSchema: tradeShape,
  }, wrap(async (a: TradeArgs) => {
    const { proposal, circuit } = await apex.proposeTrade(toInput(a), src(a.source));
    return reply(`Proposal ${proposal.id} (${proposal.mode.toUpperCase()}): ${proposal.summary}. ${circuitSummary(circuit)} Execute with execute_proposal (confirm: true) within 120 s.`, { mode: apex.mode, proposal, circuit });
  }));

  server.registerTool("execute_proposal", {
    title: "Execute a proposal",
    description: `Executes a stored proposal after explicit confirmation (confirm: true). Re-fetches fresh data and re-runs the Risk Referee first; refuses expired, changed or blocked proposals. PAPER simulates the fill; LIVE (only with APEX_MODE=live and API keys) sends one reduce-only order to Strike and reports Strike's reconciled status. Only call this after the user explicitly confirms. ${DISCLAIMER}`,
    inputSchema: { proposalId: z.string(), confirm: z.boolean().describe("Must be true, and only after the human explicitly confirmed this specific action") },
    annotations: { destructiveHint: true },
  }, wrap(async (a: { proposalId: string; confirm: boolean }) => {
    const r = await apex.executeProposal(a.proposalId, a.confirm);
    return reply(`${r.label} execution of ${r.proposalId}: ${r.status}. Referee ${r.verdict.decision}${r.verdict.violations.length ? ` (${r.verdict.violations.map((v) => `${v.id} ${v.message}`).join("; ")})` : ""}. Decision log #${r.logSeq}.`, r);
  }));

  server.registerTool("cancel_order", {
    title: "Propose a cancel",
    description: `Creates a cancel proposal for an order (engine order id, or a paper-… id). Nothing is sent until execute_proposal with confirm: true. ${DISCLAIMER}`,
    inputSchema: { symbol: z.string(), orderId: z.string(), source },
    annotations: { destructiveHint: true },
  }, wrap(async (a: { symbol: string; orderId: string; source?: PositionSource }) => {
    const p = await apex.proposeCancel(a.symbol, a.orderId, src(a.source));
    return reply(`Cancel proposal ${p.id} (${p.mode.toUpperCase()}) for order ${a.orderId} on ${a.symbol}; referee ${p.verdict.decision}. Execute with execute_proposal (confirm: true) within 120 s.`, { mode: apex.mode, proposal: p });
  }));

  server.registerTool("get_policy", {
    title: "Get risk policy",
    description: "The Risk Referee policy: leverage, notional, concentration and liquidation-distance limits, closed-session rules, action rate, confirmation.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, wrap(async () => {
    const p = apex.getPolicy();
    return reply(`Policy: max ${p.maxLeverage}x (${p.weekend.maxLeverageWhenUnderlyingClosed}x when the underlying is closed/unknown), $${p.maxPositionNotionalUsd} per position, $${p.maxPortfolioNotionalUsd} portfolio, ${p.maxSingleMarketConcentrationPct}% concentration, ≥${p.minLiquidationDistancePct}% liquidation distance, ${p.maxActionsPerHour} actions/hour.`, { mode: apex.mode, policy: p });
  }));

  server.registerTool("set_policy", {
    title: "Update risk policy",
    description: "Partially update the Risk Referee policy. Validated; invalid values are rejected. USD and percent values are decimal strings.",
    inputSchema: {
      maxLeverage: z.number().int().min(1).max(100).optional(),
      maxPositionNotionalUsd: decStr.optional(),
      maxPortfolioNotionalUsd: decStr.optional(),
      maxSingleMarketConcentrationPct: decStr.optional(),
      minLiquidationDistancePct: decStr.optional(),
      allowedClasses: z.array(z.enum(["crypto", "equity", "index", "commodity", "fx"])).optional(),
      blockedSymbols: z.array(z.string()).optional(),
      weekend: z.object({ maxLeverageWhenUnderlyingClosed: z.number().int().min(1).optional(), blockNewPositionsWhenUnderlyingClosed: z.boolean().optional() }).optional(),
      maxActionsPerHour: z.number().int().min(0).optional(),
      requireHumanConfirm: z.boolean().optional(),
    },
    annotations: { idempotentHint: true },
  }, wrap(async (a: Record<string, unknown>) => {
    const patch = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined));
    const p = apex.setPolicy(patch);
    return reply(`Policy updated: ${Object.keys(patch).join(", ")}. Logged.`, { mode: apex.mode, policy: p });
  }));

  server.registerTool("get_decision_log", {
    title: "Decision log",
    description: "Latest entries of Apex's append-only, hash-chained, signed decision log (proposals, verdicts, executions, simulations).",
    inputSchema: { limit: z.number().int().min(1).max(500).default(20) },
    annotations: { readOnlyHint: true },
  }, wrap(async (a: { limit: number }) => {
    const e = apex.decisionLog(a.limit);
    return reply(`${e.length} latest decision-log entries (${e.map((x) => `#${x.seq} ${x.type}`).join(", ")}).`, { entries: e });
  }));

  server.registerTool("verify_log", {
    title: "Verify decision log",
    description: "Recomputes the decision log hash chain and checks every Ed25519 signature.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, wrap(async () => {
    const r = apex.verifyLog();
    return reply(r.ok ? `Decision log verified: ${r.entries} entries, chain and signatures intact (key ${r.publicKey.slice(0, 16)}…).` : `Decision log verification FAILED at seq ${r.firstBadSeq}: ${r.error}`, r);
  }));

  server.registerTool("get_fair_value", {
    title: "Fair-value band",
    description: "For a stock or index perp while its underlying market is closed: implied price from the last mark at the close and the reference index perp's move since (β from weekday 1h returns), with a ±2σ band. Shows β, R² and samples; R² < 0.2 means no reliable band. ESTIMATE. " + DISCLAIMER,
    inputSchema: { symbol: z.string() },
    annotations: { readOnlyHint: true },
  }, wrap(async ({ symbol }: { symbol: string }) => {
    const f = await apex.fairValue(symbol);
    const s = f.status === "OK"
      ? symbol + " fair value (ESTIMATE): implied " + f.implied + ", band " + f.bandLow + "–" + f.bandHigh + " (±" + f.bandHalfWidthPct + "%), mark " + f.mark + " is " + f.deviationPct + "% from implied. " + f.note + "."
      : symbol + " fair value: " + f.status + " — " + f.note + (f.beta ? " (β " + f.beta + ", R² " + f.r2 + ", n=" + f.samples + ")" : "") + ".";
    return reply(s + " " + DISCLAIMER, { mode: apex.mode, ...f });
  }));

  const creditShape = {
    asset: z.string().default("ADA").describe("Collateral asset id from /v2/credit/settings, e.g. ADA"),
    collateralUnits: decStr.describe("q: pledged collateral units (user-entered)"),
    debtUsd: decStr.describe("D: credit-line debt in USD (user-entered)"),
    encumberedShares: decStr.describe("s: encumbered SLP shares (user-entered)"),
  };
  type CreditArgs = { asset: string; collateralUnits: string; debtUsd: string; encumberedShares: string };

  server.registerTool("credit_line_health", {
    title: "Credit Line Copilot",
    description: "Borrow-and-Earn credit-line health with the exact formulas from Strike's docs: c, v, joint risk J, credit health score, Active/Recovery state, recovery-boundary collateral price, and the minimum repay or extra collateral to reach the completion targets. Line values are user-entered (Strike has no per-user credit-line endpoint); collateral and SLP share prices are live. " + DISCLAIMER,
    inputSchema: creditShape,
    annotations: { readOnlyHint: true },
  }, wrap(async (a: CreditArgs) => {
    const r = await apex.creditLineHealth(a);
    const fix = r.fixToCompletionTargets.alreadyMeets
      ? "Already past the completion targets."
      : "To reach the completion targets: repay about $" + r.fixToCompletionTargets.repayUsd + " or add about " + r.fixToCompletionTargets.orAddCollateralUnits + " " + a.asset + ".";
    return reply(
      "Credit line (" + a.asset + ", user-entered values; prices LIVE): health " + r.health.credit + " (" + r.health.state + "; joint " + r.health.joint + ", floor " + r.health.floor + "), J = " + r.values.J +
      ". Collateral $" + r.values.collateralValueUsd + " at " + r.live.collateralPrice + ", vault $" + r.values.vaultValueUsd +
      ". Recovery starts at " + a.asset + " ≈ $" + r.recoveryBoundary.collateralPrice + " (" + r.recoveryBoundary.binds + " binds, " + r.recoveryBoundary.distancePct + "% below now). " + fix + " " + r.warnings.join(" ") + " " + DISCLAIMER,
      r,
    );
  }));

  server.registerTool("credit_stress_grid", {
    title: "Credit stress heatmap",
    description: "Credit health across collateral price changes (0 to −50%) × SLP drawdowns (0 to −30%), with Recovery cells marked. SCENARIO numbers. " + DISCLAIMER,
    inputSchema: creditShape,
    annotations: { readOnlyHint: true },
  }, wrap(async (a: CreditArgs) => {
    const r = await apex.creditStressGrid(a);
    const cells = r.grid.flat();
    return reply("Credit stress grid (SCENARIO): " + cells.filter((c) => c.state === "RECOVERY").length + " of " + cells.length + " cells are in Recovery. " + DISCLAIMER, r);
  }));

  return server;
}
