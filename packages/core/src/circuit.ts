// Circuit — pre-trade simulator (CLAUDE.md §6.5). Pure: all data comes in through CircuitData.
// Every number carries a label (LIVE / ESTIMATE / SCENARIO) and a basis naming its inputs.
import { FRESHNESS_MS } from "@apex/config";
import { type MarketMath, type PositionInput, derive, liqAndBankruptcy, marketMaxLeverage, tierIndexByLeverage } from "./margin.js";
import { D, type Dec, dec, floorToStep } from "./money.js";
import type { Policy } from "./policy.js";
import { type Action, type LiqEstimate, type Mode, type PortfolioPosition, type RefereeContext, type Side, type Verdict, evaluate } from "./referee.js";
import type { MarketRecord } from "./registry.js";
import type { Depth, FeeTiers, MarketInfo } from "./schemas.js";

export type Label = "LIVE" | "ESTIMATE" | "SCENARIO" | "PAPER";
export interface Num { value: string | null; label: Label; basis: string }
const num = (value: Dec | string | null, label: Label, basis: string, dp?: number): Num => ({
  value: value === null ? null : typeof value === "string" ? value : dp === undefined ? value.toString() : value.toFixed(dp),
  label,
  basis,
});

export interface CircuitInput {
  symbol: string;
  side: Side;
  /** Exactly one of notionalUsd / size. */
  notionalUsd?: string;
  size?: string;
  leverage: number;
  orderType: "market" | "limit";
  limitPrice?: string;
  stopLoss?: string;
  takeProfit?: string;
  /** Extra adverse move for the stress table, in percent (e.g. "12"). */
  customMovePct?: string;
}

export interface AccountView {
  /** LIVE = the user's Strike account; PAPER = Apex paper ledger. */
  source: "LIVE" | "PAPER";
  walletBalance: string;
  positions: PositionInput[];
  /** Margin mode new orders on this symbol would use. */
  marginModeFor: (symbol: string) => "cross" | "isolated";
  fetchedAt: number;
}

export interface GapInfo { pGap: string | null; band: "LOW" | "MEDIUM" | "HIGH" | "N/A"; method: string; samples: number }

export interface CircuitData {
  now: number;
  mode: Mode;
  liveEnvEnabled: boolean;
  market: MarketRecord | undefined;
  /** /v2/markets entries (tiers, quote_prec, mark) for every symbol the account holds plus this one. */
  markets: Record<string, MarketInfo>;
  marketsFetchedAt: number;
  depth: Depth | null;
  depthFetchedAt: number | null;
  feeTiers: FeeTiers | null;
  account: AccountView | null;
  actionsInLastHour: number;
  gap?: GapInfo;
}

export interface DepthWalk { avgPrice: Dec | null; filled: Dec; insufficient: boolean; levelsUsed: number; best: Dec | null }

/** Walk /v2/depth levels for `size` (asks for buys, bids for sells). */
export function walkDepth(depth: Depth, side: Side, size: Dec): DepthWalk {
  const levels = side === "buy" ? depth.asks : depth.bids;
  let remaining = size, cost = new D(0), filled = new D(0), used = 0;
  for (const [p, q] of levels) {
    if (remaining.lte(0)) break;
    const take = D.min(remaining, dec(q));
    cost = cost.add(take.mul(dec(p)));
    filled = filled.add(take);
    remaining = remaining.sub(take);
    used++;
  }
  const best = levels[0] ? dec(levels[0][0]) : null;
  return { avgPrice: filled.gt(0) ? cost.div(filled) : null, filled, insufficient: remaining.gt(0), levelsUsed: used, best };
}

export interface CircuitReport {
  mode: Mode;
  symbol: string;
  side: Side;
  orderType: "market" | "limit";
  leverage: number;
  size: Num;
  notionalUsd: Num;
  entryPrice: Num;
  markPrice: Num;
  stale: { stale: boolean; reasons: string[] };
  exchangeWarnings: string[];
  liquidation: { price: Num; distancePct: Num; marginMode: string; basis: string };
  fees: { takerRate: Num; makerRate: Num; openCostUsd: Num; closeCostUsd: Num; tierNote: string };
  slippage: { avgFill: Num; slippageBpsVsMark: Num; slippageBpsVsBest: Num; insufficientDepth: boolean; levelsUsed: number };
  funding: { hourlyRate: Num; costPerHourUsd: Num; costPer24hUsd: Num };
  portfolio: {
    before: { totalNotionalUsd: Num; effectiveLeverage: Num; concentrationPct: Num; marginUtilizationPct: Num };
    after: { totalNotionalUsd: Num; effectiveLeverage: Num; concentrationPct: Num; marginUtilizationPct: Num };
    accountSource: string;
  };
  stress: Array<{ movePct: string; price: Num; pnlUsd: Num; liquidated: boolean }>;
  riskReward: { lossUsd: Num; gainUsd: Num; ratio: Num } | null;
  weekend: { underlying: string; hoursUntilNextOpen: Num; gap: GapInfo | null; notes: string[] };
  verdict: Verdict;
  alternativeReport?: Omit<CircuitReport, "alternativeReport">;
}

const BPS = new D(10000);

interface Resulting { size: Dec; entry: Dec; isoBalance: Dec }

function combine(oldSize: Dec, oldEntry: Dec, fillSize: Dec, fillPrice: Dec): { size: Dec; entry: Dec } {
  // strike-calculations "Entry Price, Realized PnL, Flips".
  const newSize = oldSize.add(fillSize);
  if (oldSize.isZero() || oldSize.isPos() === fillSize.isPos()) {
    return { size: newSize, entry: oldSize.abs().mul(oldEntry).add(fillSize.abs().mul(fillPrice)).div(newSize.abs()) };
  }
  if (newSize.isZero()) return { size: newSize, entry: new D(0) };
  if (newSize.isPos() === oldSize.isPos()) return { size: newSize, entry: oldEntry }; // reduce
  return { size: newSize, entry: fillPrice }; // flip
}

/**
 * Liquidation estimate for the position that results from filling `fill` at `price` with `leverage`.
 * - Account present: the account's margin mode for the symbol; cross uses the real wallet and every
 *   other cross position (strike-calculations "Margin Profiles").
 * - No account: isolated-equivalent — iso_balance = notional / leverage (ESTIMATE).
 */
export function estimateLiquidation(
  data: CircuitData,
  symbol: string,
  fillSigned: Dec,
  price: Dec,
  leverage: number,
): { lp: Dec; mode: "cross" | "isolated"; basis: string; resulting: Resulting } | { error: string } {
  const info = data.markets[symbol];
  if (!info) return { error: `no /v2/markets data for ${symbol}` };
  const mark = dec(info.mark_price);
  const acct = data.account;
  const existing = acct?.positions.find((p) => p.symbol === symbol && !dec(p.size).isZero());
  const oldSize = existing ? dec(existing.size) : new D(0);
  const oldEntry = existing ? dec(existing.entry_price) : new D(0);
  const { size, entry } = combine(oldSize, oldEntry, fillSigned, price);
  if (size.isZero()) return { lp: new D(0), mode: "isolated", basis: "position fully closed", resulting: { size, entry, isoBalance: new D(0) } };
  const mode = acct ? (existing?.margin_mode ?? acct.marginModeFor(symbol)) : "isolated";
  const lev = existing ? existing.leverage : leverage;
  const d = derive(size, entry, lev, mark, info.margin_tiers, info.quote_prec);
  if (mode === "isolated") {
    // Opening/increasing: iso_balance += ceil(fillSize·fillPrice/leverage) (strike-calculations "Isolated Margin Adjustments").
    const add = fillSigned.abs().mul(price).div(lev).toDecimalPlaces(info.quote_prec, D.ROUND_CEIL);
    const iso = (existing ? dec(existing.iso_balance) : new D(0)).add(oldSize.isZero() || oldSize.isPos() === fillSigned.isPos() ? add : new D(0));
    const { lp } = liqAndBankruptcy(size, entry, d, info.margin_tiers, { W: iso, upnl: d.upnl, mm: d.mm, count: 1 });
    return {
      lp, mode, resulting: { size, entry, isoBalance: iso },
      basis: acct ? `isolated, iso_balance ${iso.toFixed(2)} (${acct.source} account)` : `isolated-equivalent: margin = notional / ${lev}x (no account data)`,
    };
  }
  // Cross: real wallet + all other cross positions at their current marks.
  const others = acct!.positions.filter((p) => p.symbol !== symbol && p.margin_mode === "cross" && !dec(p.size).isZero());
  let upnl = d.upnl, mm = d.mm;
  for (const p of others) {
    const m = data.markets[p.symbol];
    if (!m) return { error: `no /v2/markets data for ${p.symbol}` };
    const od = derive(dec(p.size), dec(p.entry_price), p.leverage, dec(m.mark_price), m.margin_tiers, m.quote_prec);
    upnl = upnl.add(od.upnl);
    mm = mm.add(od.mm);
  }
  const isoSum = acct!.positions.filter((p) => p.margin_mode === "isolated").reduce((s, p) => s.add(dec(p.iso_balance)), new D(0));
  const W = dec(acct!.walletBalance).sub(isoSum);
  const { lp } = liqAndBankruptcy(size, entry, d, info.margin_tiers, { W, upnl, mm, count: others.length + 1 });
  return { lp, mode, basis: `cross, wallet ${W.toFixed(2)} − iso, ${others.length} other cross position(s) (${acct!.source} account)`, resulting: { size, entry, isoBalance: new D(0) } };
}

function liqEstimate(r: ReturnType<typeof estimateLiquidation>, mark: Dec): LiqEstimate {
  if ("error" in r) return { kind: "unavailable", reason: r.error };
  if (r.lp.isZero()) return { kind: "none" };
  return { kind: "value", pct: r.lp.sub(mark).abs().div(mark).mul(100).toString() };
}

function portfolioPositions(data: CircuitData): PortfolioPosition[] {
  if (!data.account) return [];
  return data.account.positions
    .filter((p) => !dec(p.size).isZero())
    .map((p) => ({ symbol: p.symbol, size: p.size, markPrice: data.markets[p.symbol]?.mark_price ?? "0", marginMode: p.margin_mode }));
}

function portfolioStats(positions: PortfolioPosition[], symbol: string, equity: Dec | null, im: Dec | null, label: Label, basis: string) {
  const total = positions.reduce((s, p) => s.add(dec(p.size).abs().mul(dec(p.markPrice))), new D(0));
  const sym = positions.filter((p) => p.symbol === symbol).reduce((s, p) => s.add(dec(p.size).abs().mul(dec(p.markPrice))), new D(0));
  return {
    totalNotionalUsd: num(total, label, basis, 2),
    effectiveLeverage: num(equity && equity.gt(0) ? total.div(equity) : null, label, "total notional ÷ equity", 2),
    concentrationPct: num(total.gt(0) ? sym.div(total).mul(100) : new D(0), label, `${symbol} notional ÷ total notional`, 2),
    marginUtilizationPct: num(equity && equity.gt(0) && im ? im.div(equity).mul(100) : null, label, "Σ initial margin ÷ equity", 2),
  };
}

export function runCircuit(input: CircuitInput, data: CircuitData, policy: Policy): CircuitReport {
  const info = data.markets[input.symbol];
  const market = data.market;
  const reasons: string[] = [];
  const exchangeWarnings: string[] = [];
  const markAge = info ? data.now - data.marketsFetchedAt : null;
  const depthAge = data.depthFetchedAt === null ? null : data.now - data.depthFetchedAt;
  const accountAge = data.account ? data.now - data.account.fetchedAt : null;
  if (!info) reasons.push("no mark price");
  else if (markAge! > FRESHNESS_MS.mark) reasons.push(`mark ${markAge} ms old`);
  if (input.orderType === "market" && (depthAge === null || depthAge > FRESHNESS_MS.depth)) reasons.push(depthAge === null ? "no depth" : `depth ${depthAge} ms old`);
  if (data.account && accountAge! > FRESHNESS_MS.account) reasons.push(`account ${accountAge} ms old`);

  const mark = info ? dec(info.mark_price) : null;
  const markN = num(mark, "LIVE", "GET /v2/markets mark_price");

  // Size and execution price.
  const f = market?.filters;
  const step = f ? dec(input.orderType === "market" ? f.marketStepSize : f.stepSize) : null;
  let size: Dec;
  let sizeBasis: string;
  const roughPx = input.orderType === "limit" && input.limitPrice ? dec(input.limitPrice) : mark;
  if (input.size) {
    size = dec(input.size);
    sizeBasis = "user size";
  } else if (input.notionalUsd && roughPx && roughPx.gt(0)) {
    const raw = dec(input.notionalUsd).div(roughPx);
    size = step ? floorToStep(raw, step) : raw;
    sizeBasis = `notional ÷ ${input.orderType === "limit" ? "limit price" : "mark"}, floored to step ${step?.toString() ?? "?"}`;
  } else {
    size = new D(0);
    sizeBasis = "no price to size from";
  }

  let walk: DepthWalk | null = null;
  if (data.depth && size.gt(0)) walk = walkDepth(data.depth, input.side, size);
  let entry: Dec | null;
  let entryBasis: string;
  if (input.orderType === "limit" && input.limitPrice) {
    entry = dec(input.limitPrice);
    entryBasis = "limit price";
  } else if (walk?.avgPrice && !walk.insufficient) {
    entry = walk.avgPrice;
    entryBasis = `depth walk over ${walk.levelsUsed} level(s)`;
  } else {
    entry = mark;
    entryBasis = walk?.insufficient ? "mark (book cannot fill the size)" : "mark (no depth)";
  }
  const notional = entry ? size.mul(entry) : new D(0);

  // Exchange constraints Strike enforces on leverage (strike-calculations "Margin Tiers").
  if (info) {
    const maxLev = marketMaxLeverage(info.margin_tiers);
    if (input.leverage > maxLev || input.leverage < 1) exchangeWarnings.push(`Strike rejects leverage ${input.leverage}x (market max ${maxLev}x)`);
    else {
      const t = info.margin_tiers[tierIndexByLeverage(info.margin_tiers, input.leverage)]!;
      if (mark && size.mul(mark).gt(dec(t.max_notional))) exchangeWarnings.push(`Position notional exceeds the ${input.leverage}x tier max ${t.max_notional}`);
    }
  }

  const held = data.account?.positions.find((p) => p.symbol === input.symbol && !dec(p.size).isZero());
  if (held && held.leverage !== input.leverage) {
    exchangeWarnings.push(`Existing ${input.symbol} position (${data.account!.source}) uses ${held.leverage}x; Strike applies the position's leverage, so the liquidation estimate uses ${held.leverage}x for the combined position`);
  }

  // Liquidation.
  const signed = input.side === "buy" ? size : size.neg();
  const liqRes = entry && size.gt(0) ? estimateLiquidation(data, input.symbol, signed, entry, input.leverage) : { error: "no size or price" };
  const liq = mark ? liqEstimate(liqRes, mark) : ({ kind: "unavailable", reason: "no mark" } as LiqEstimate);
  const lpN = "error" in liqRes ? num(null, "ESTIMATE", liqRes.error) : num(liqRes.lp.isZero() ? "0 (none)" : liqRes.lp.toSignificantDigits(10).toString(), "ESTIMATE", "strike-calculations LP formula");
  const distN = num(liq.kind === "value" ? dec(liq.pct) : null, "ESTIMATE", liq.kind === "value" ? "|mark − liq| ÷ mark" : liq.kind === "none" ? "no liquidation price" : liq.reason, 2);

  // Fees (/v2/fee-tiers; account tier unknown → base tier 0).
  const tier0 = data.feeTiers?.feeTiers.find((t) => t.Tier === 0);
  const taker = tier0 ? dec(tier0.TakerRate) : null;
  const maker = tier0 ? dec(tier0.MakerRate) : null;
  const openRate = input.orderType === "market" ? taker : maker;
  const fees = {
    takerRate: num(taker, "LIVE", "GET /v2/fee-tiers tier 0"),
    makerRate: num(maker, "LIVE", "GET /v2/fee-tiers tier 0 (negative = rebate)"),
    openCostUsd: num(openRate ? notional.mul(openRate) : null, "ESTIMATE", input.orderType === "market" ? "notional × taker" : "notional × maker (if it rests and fills as maker)", 4),
    closeCostUsd: num(taker && mark ? size.mul(mark).mul(taker) : null, "ESTIMATE", "size × mark × taker (market close)", 4),
    tierNote: "Base fee tier 0 used (account tier not read); referral/staking discounts not applied.",
  };

  // Slippage.
  const slippage = {
    avgFill: num(walk?.avgPrice ?? null, "ESTIMATE", "depth walk (GET /price/v2/depth)"),
    slippageBpsVsMark: num(walk?.avgPrice && mark ? walk.avgPrice.sub(mark).abs().div(mark).mul(BPS) : null, "ESTIMATE", "|avg fill − mark| ÷ mark", 2),
    slippageBpsVsBest: num(walk?.avgPrice && walk.best ? walk.avgPrice.sub(walk.best).abs().div(walk.best).mul(BPS) : null, "ESTIMATE", "|avg fill − best level| ÷ best", 2),
    insufficientDepth: walk?.insufficient ?? input.orderType === "market",
    levelsUsed: walk?.levelsUsed ?? 0,
  };

  // Funding (CLAUDE.md §4.8; fundingRate is hourly, VERIFICATION #6). Positive cost = you pay.
  const rate = info ? dec(info.funding_rate) : null;
  const perHour = rate && mark ? signed.mul(mark).mul(rate) : null;
  const funding = {
    hourlyRate: num(rate, "LIVE", "GET /v2/markets funding_rate (current-hour estimate)"),
    costPerHourUsd: num(perHour, "ESTIMATE", "signed size × mark × hourly rate (+ = you pay)", 4),
    costPer24hUsd: num(perHour ? perHour.mul(24) : null, "ESTIMATE", "hourly estimate × 24, rate held constant", 4),
  };

  // Portfolio impact.
  const before = portfolioPositions(data);
  const afterPos = before.filter((p) => p.symbol !== input.symbol);
  const curSym = before.find((p) => p.symbol === input.symbol);
  const resultingSize = (curSym ? dec(curSym.size) : new D(0)).add(signed);
  if (!resultingSize.isZero()) afterPos.push({ symbol: input.symbol, size: resultingSize.toString(), markPrice: mark?.toString() ?? "0", marginMode: "isolated" });
  const acctLabel: Label = data.account?.source === "PAPER" ? "PAPER" : "LIVE";
  const equityBefore = data.account ? accountEquity(data) : null;
  const imBefore = data.account ? accountIM(data) : null;
  const imAfter = imBefore !== null ? imBefore.add(notional.div(input.leverage)) : notional.div(input.leverage);
  const portfolio = {
    before: portfolioStats(before, input.symbol, equityBefore, imBefore, acctLabel, "positions × mark"),
    after: portfolioStats(afterPos, input.symbol, equityBefore ?? notional.div(input.leverage), imAfter, "ESTIMATE", "positions after fill × mark"),
    accountSource: data.account ? `${data.account.source} account` : "no account data — portfolio shows this trade only; equity = its initial margin",
  };

  // Stress (SCENARIO): adverse moves; other positions held constant.
  const moves = ["2", "5", "8", ...(input.customMovePct ? [input.customMovePct] : [])];
  const stress = moves.map((m) => {
    if (!mark || !entry) return { movePct: m, price: num(null, "SCENARIO", "no price"), pnlUsd: num(null, "SCENARIO", "no price"), liquidated: false };
    const k = dec(m).div(100);
    const p = input.side === "buy" ? mark.mul(new D(1).sub(k)) : mark.mul(new D(1).add(k));
    const pnl = p.sub(entry).mul(signed);
    const lp = "error" in liqRes ? null : liqRes.lp;
    const liquidated = lp !== null && !lp.isZero() && (input.side === "buy" ? p.lte(lp) : p.gte(lp));
    return { movePct: m, price: num(p, "SCENARIO", `mark ${input.side === "buy" ? "−" : "+"}${m}%`, 4), pnlUsd: num(pnl, "SCENARIO", "(price − entry) × signed size, before fees", 2), liquidated };
  });

  // Risk / reward.
  let riskReward: CircuitReport["riskReward"] = null;
  if (entry && (input.stopLoss || input.takeProfit)) {
    const loss = input.stopLoss ? dec(input.stopLoss).sub(entry).mul(signed) : null;
    const gain = input.takeProfit ? dec(input.takeProfit).sub(entry).mul(signed) : null;
    riskReward = {
      lossUsd: num(loss, "SCENARIO", "(stop − entry) × signed size, before fees", 2),
      gainUsd: num(gain, "SCENARIO", "(take-profit − entry) × signed size, before fees", 2),
      ratio: num(loss && gain && !loss.isZero() ? gain.div(loss.abs()) : null, "SCENARIO", "gain ÷ |loss|", 2),
    };
  }

  // Weekend exposure.
  const st = market?.sessionState;
  const weekend = {
    underlying: st?.underlying ?? "unknown",
    hoursUntilNextOpen: num(st?.underlying !== "open" && st?.nextOpen ? new D(st.nextOpen - data.now).div(3600_000) : null, "ESTIMATE", market?.sessionSource ?? "no session data", 1),
    gap: data.gap ?? null,
    notes: market?.notes ?? [],
  };

  // Verdict.
  const action: Action = { kind: "open", symbol: input.symbol, side: input.side, size: size.toString(), orderType: input.orderType, ...(input.limitPrice ? { price: input.limitPrice } : {}), leverage: input.leverage };
  const ctx: RefereeContext = {
    stage: "propose",
    mode: data.mode,
    liveEnvEnabled: data.liveEnvEnabled,
    humanConfirmed: false,
    market: market ? { symbol: market.symbol, class: market.class, perpStatus: market.perpStatus, underlying: market.sessionState.underlying, filters: market.filters } : null,
    markPrice: mark?.toString() ?? null,
    refPrice: entry?.toString() ?? null,
    dataAgesMs: { mark: markAge, depth: depthAge, account: data.account ? accountAge : 0 },
    portfolio: before,
    liquidation: liq,
    actionsInLastHour: data.actionsInLastHour,
    liqDistanceAt: (lev, sz) => {
      const s = dec(sz);
      const w = data.depth && input.orderType === "market" ? walkDepth(data.depth, input.side, s) : null;
      const px = input.orderType === "limit" && input.limitPrice ? dec(input.limitPrice) : w?.avgPrice && !w.insufficient ? w.avgPrice : mark;
      if (!px || !mark) return { kind: "unavailable", reason: "no price" };
      return liqEstimate(estimateLiquidation(data, input.symbol, input.side === "buy" ? s : s.neg(), px, lev), mark);
    },
  };
  // Without an account (paper, no ledger) there is no account input to be stale.
  const verdict = evaluate(action, ctx, policy);

  const report: CircuitReport = {
    mode: data.mode,
    symbol: input.symbol,
    side: input.side,
    orderType: input.orderType,
    leverage: input.leverage,
    size: num(size, "ESTIMATE", sizeBasis),
    notionalUsd: num(notional, "ESTIMATE", `size × ${entryBasis}`, 2),
    entryPrice: num(entry, "ESTIMATE", entryBasis),
    markPrice: markN,
    stale: { stale: reasons.length > 0, reasons },
    exchangeWarnings,
    liquidation: { price: lpN, distancePct: distN, marginMode: "error" in liqRes ? "unknown" : liqRes.mode, basis: "error" in liqRes ? liqRes.error : liqRes.basis },
    fees,
    slippage,
    funding,
    portfolio,
    stress,
    riskReward,
    weekend,
    verdict,
  };
  if (verdict.alternative && verdict.alternative.kind === "open") {
    const alt = verdict.alternative;
    const altReport = runCircuit({ ...input, size: alt.size, notionalUsd: undefined, leverage: alt.leverage }, data, policy);
    delete (altReport as Partial<CircuitReport>).alternativeReport;
    report.alternativeReport = altReport;
  }
  return report;
}

function accountEquity(data: CircuitData): Dec {
  // Cross margin balance + isolated balances + isolated uPnL ≈ total equity.
  const acct = data.account!;
  let upnl = new D(0);
  for (const p of acct.positions) {
    const m = data.markets[p.symbol];
    if (!m || dec(p.size).isZero()) continue;
    upnl = upnl.add(dec(m.mark_price).sub(dec(p.entry_price)).mul(dec(p.size)));
  }
  return dec(acct.walletBalance).add(upnl);
}

function accountIM(data: CircuitData): Dec {
  const acct = data.account!;
  let im = new D(0);
  for (const p of acct.positions) {
    const m = data.markets[p.symbol];
    if (!m || dec(p.size).isZero() || p.leverage <= 0) continue;
    im = im.add(dec(p.size).abs().mul(dec(m.mark_price)).div(p.leverage));
  }
  return im;
}

export type { MarketMath };
