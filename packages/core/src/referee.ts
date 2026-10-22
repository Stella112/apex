// Risk Referee (CLAUDE.md §6.3): deterministic, pure. Numbers come in through the context
// (Circuit computes liquidation estimates; the referee only judges them).
import { FRESHNESS_MS } from "@apex/config";
import { D, type Dec, dec } from "./money.js";
import type { Policy } from "./policy.js";
import type { ExchangeFilters, RegistryClass } from "./registry.js";
import type { UnderlyingState } from "./sessions.js";

export type Side = "buy" | "sell";
export type Mode = "paper" | "live";

export type Action =
  | { kind: "open"; symbol: string; side: Side; size: string; orderType: "market" | "limit"; price?: string; leverage: number }
  | { kind: "protective_stop"; symbol: string; side: Side; size: string; stopPrice: string; reduceOnly: boolean }
  | { kind: "partial_close"; symbol: string; side: Side; size: string; reduceOnly: boolean; slippage: string }
  | { kind: "iso_margin_add"; symbol: string; amount: string }
  | { kind: "cancel"; symbol: string; orderId: string };

export type LiqEstimate =
  | { kind: "value"; pct: string } // distance |mark − liq| / mark × 100
  | { kind: "none" } // Strike convention: liquidation_price "0" = none
  | { kind: "unavailable"; reason: string };

export interface PortfolioPosition {
  symbol: string;
  /** signed: + long, − short */
  size: string;
  markPrice: string;
  marginMode: "cross" | "isolated";
}

export interface RefereeContext {
  stage: "propose" | "execute";
  mode: Mode;
  /** APEX_MODE=live in env */
  liveEnvEnabled: boolean;
  /** explicit per-action human confirmation (execute_proposal confirm: true) */
  humanConfirmed: boolean;
  /** null = unknown symbol → fail closed */
  market: { symbol: string; class: RegistryClass; perpStatus: string; underlying: UnderlyingState; filters: ExchangeFilters | null } | null;
  markPrice: string | null;
  /** Expected execution price for notional (limit price, depth-walk average, or mark). Defaults to mark. */
  refPrice?: string | null;
  /** Age of each input at evaluation time; null = missing. */
  dataAgesMs: { mark: number | null; depth: number | null; account: number | null };
  portfolio: PortfolioPosition[];
  /** Liquidation estimate for the resulting position (from Circuit). */
  liquidation: LiqEstimate;
  actionsInLastHour: number;
  /** Used by the alternative generator to re-estimate liquidation for a smaller/lower-leverage order. */
  liqDistanceAt?: (leverage: number, size: string) => LiqEstimate;
}

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11" | "R12";

export interface RuleResult {
  id: RuleId;
  status: "pass" | "fail" | "warn" | "skipped";
  message: string;
  numbers: Record<string, string>;
}

export interface Verdict {
  decision: "APPROVE" | "BLOCK";
  violations: RuleResult[];
  warnings: RuleResult[];
  checks: RuleResult[];
  alternative?: Action;
}

const REDUCTIONS = new Set<Action["kind"]>(["protective_stop", "partial_close", "iso_margin_add"]);
export const isReduction = (a: Action) => REDUCTIONS.has(a.kind);

const pass = (id: RuleId, message: string, numbers: Record<string, string> = {}): RuleResult => ({ id, status: "pass", message, numbers });
const fail = (id: RuleId, message: string, numbers: Record<string, string> = {}): RuleResult => ({ id, status: "fail", message, numbers });
const warn = (id: RuleId, message: string, numbers: Record<string, string> = {}): RuleResult => ({ id, status: "warn", message, numbers });
const skip = (id: RuleId, message: string): RuleResult => ({ id, status: "skipped", message, numbers: {} });

const signedDelta = (side: Side, size: Dec) => (side === "buy" ? size : size.neg());

function existing(ctx: RefereeContext, symbol: string): PortfolioPosition | undefined {
  return ctx.portfolio.find((p) => p.symbol === symbol && !dec(p.size).isZero());
}

/** Resulting notional numbers for an `open` action. */
export function exposure(action: Extract<Action, { kind: "open" }>, ctx: RefereeContext) {
  const price = dec(ctx.refPrice ?? ctx.markPrice ?? "0");
  const cur = existing(ctx, action.symbol);
  const curSize = cur ? dec(cur.size) : new D(0);
  const resultingSize = curSize.add(signedDelta(action.side, dec(action.size)));
  const symbolNotional = resultingSize.abs().mul(price);
  const others = ctx.portfolio
    .filter((p) => p.symbol !== action.symbol)
    .reduce((acc, p) => acc.add(dec(p.size).abs().mul(dec(p.markPrice))), new D(0));
  return { price, resultingSize, symbolNotional, portfolioNotional: others.add(symbolNotional) };
}

/**
 * Concentration % for R4. Denominator = max(resulting portfolio notional, maxPortfolioNotionalUsd),
 * i.e. the share of the allowed book. PENDING Maris decision (BLOCKERS B3): the literal reading
 * (symbol ÷ resulting portfolio) makes every first trade 100% and always blocks.
 */
export function concentrationPct(symbolNotional: Dec, portfolioNotional: Dec, policy: Policy): Dec {
  const denom = D.max(portfolioNotional, dec(policy.maxPortfolioNotionalUsd));
  return denom.isZero() ? new D(0) : symbolNotional.div(denom).mul(100);
}

function effectiveMaxLeverage(ctx: RefereeContext, policy: Policy): number {
  const u = ctx.market?.underlying;
  return u === "closed" || u === "unknown" ? Math.min(policy.maxLeverage, policy.weekend.maxLeverageWhenUnderlyingClosed) : policy.maxLeverage;
}

function isMultiple(x: Dec, step: Dec): boolean {
  return x.div(step).isInteger();
}

// ── individual rules ──────────────────────────────────────────────────────────

function r1(a: Extract<Action, { kind: "open" }>, ctx: RefereeContext, policy: Policy): RuleResult {
  const max = effectiveMaxLeverage(ctx, policy);
  const u = ctx.market?.underlying ?? "unknown";
  const nums = { leverage: String(a.leverage), max: String(max), underlying: u };
  if (policy.weekend.blockNewPositionsWhenUnderlyingClosed && (u === "closed" || u === "unknown")) {
    return fail("R1", `New positions are blocked while the underlying session is ${u}`, nums);
  }
  return a.leverage <= max
    ? pass("R1", `Leverage ${a.leverage}x within max ${max}x`, nums)
    : fail("R1", `Leverage ${a.leverage}x exceeds max ${max}x${max < policy.maxLeverage ? ` (underlying ${u})` : ""}`, nums);
}

function r2(a: Extract<Action, { kind: "open" }>, ctx: RefereeContext, policy: Policy): RuleResult {
  const { symbolNotional } = exposure(a, ctx);
  const max = dec(policy.maxPositionNotionalUsd);
  const nums = { positionNotionalUsd: symbolNotional.toFixed(2), maxUsd: max.toFixed(2) };
  return symbolNotional.lte(max)
    ? pass("R2", `Position notional $${nums.positionNotionalUsd} within $${nums.maxUsd}`, nums)
    : fail("R2", `Position notional $${nums.positionNotionalUsd} exceeds $${nums.maxUsd}`, nums);
}

function r3(a: Extract<Action, { kind: "open" }>, ctx: RefereeContext, policy: Policy): RuleResult {
  const { portfolioNotional } = exposure(a, ctx);
  const max = dec(policy.maxPortfolioNotionalUsd);
  const nums = { portfolioNotionalUsd: portfolioNotional.toFixed(2), maxUsd: max.toFixed(2) };
  return portfolioNotional.lte(max)
    ? pass("R3", `Portfolio notional $${nums.portfolioNotionalUsd} within $${nums.maxUsd}`, nums)
    : fail("R3", `Portfolio notional $${nums.portfolioNotionalUsd} exceeds $${nums.maxUsd}`, nums);
}

function r4(a: Extract<Action, { kind: "open" }>, ctx: RefereeContext, policy: Policy): RuleResult {
  const { symbolNotional, portfolioNotional } = exposure(a, ctx);
  const pct = concentrationPct(symbolNotional, portfolioNotional, policy);
  const max = dec(policy.maxSingleMarketConcentrationPct);
  const nums = { concentrationPct: pct.toFixed(2), maxPct: max.toFixed(2) };
  return pct.lte(max)
    ? pass("R4", `Concentration ${nums.concentrationPct}% within ${nums.maxPct}%`, nums)
    : fail("R4", `Concentration ${nums.concentrationPct}% exceeds ${nums.maxPct}%`, nums);
}

function r5(liq: LiqEstimate, policy: Policy): RuleResult {
  const min = dec(policy.minLiquidationDistancePct);
  if (liq.kind === "none") return pass("R5", "No liquidation price for the resulting position", { minPct: min.toFixed(2) });
  if (liq.kind === "unavailable") return fail("R5", `Liquidation estimate unavailable: ${liq.reason}`, { minPct: min.toFixed(2) });
  const pct = dec(liq.pct);
  const nums = { liquidationDistancePct: pct.toFixed(2), minPct: min.toFixed(2) };
  return pct.gte(min)
    ? pass("R5", `Liquidation distance ${nums.liquidationDistancePct}% ≥ ${nums.minPct}%`, nums)
    : fail("R5", `Liquidation distance ${nums.liquidationDistancePct}% below ${nums.minPct}%`, nums);
}

function r6(ctx: RefereeContext, policy: Policy, symbol: string): RuleResult {
  const cls = ctx.market?.class ?? "unknown";
  if (policy.blockedSymbols.includes(symbol)) return fail("R6", `${symbol} is on the blocked list`, { symbol });
  return (policy.allowedClasses as string[]).includes(cls)
    ? pass("R6", `Class ${cls} allowed`, { class: cls })
    : fail("R6", `Class ${cls} not allowed`, { class: cls });
}

function r7(ctx: RefereeContext): RuleResult {
  const s = ctx.market?.perpStatus ?? "UNKNOWN";
  return s === "ACTIVE" ? pass("R7", "Market ACTIVE", { status: s }) : fail("R7", `Market status ${s}, not ACTIVE`, { status: s });
}

function r8(ctx: RefereeContext, need: { mark: boolean; depth: boolean; account: boolean }): RuleResult {
  const problems: string[] = [];
  const nums: Record<string, string> = {};
  for (const k of ["mark", "depth", "account"] as const) {
    if (!need[k]) continue;
    const age = ctx.dataAgesMs[k];
    const limit = FRESHNESS_MS[k];
    nums[`${k}AgeMs`] = age === null ? "missing" : String(age);
    nums[`${k}LimitMs`] = String(limit);
    if (age === null) problems.push(`${k} data missing`);
    else if (age > limit) problems.push(`${k} data ${age} ms old (limit ${limit} ms)`);
  }
  return problems.length ? fail("R8", `Stale or missing data: ${problems.join("; ")}`, nums) : pass("R8", "Data fresh", nums);
}

function r9(ctx: RefereeContext, policy: Policy): RuleResult {
  const nums = { actionsInLastHour: String(ctx.actionsInLastHour), max: String(policy.maxActionsPerHour) };
  return ctx.actionsInLastHour + 1 <= policy.maxActionsPerHour
    ? pass("R9", `Action ${ctx.actionsInLastHour + 1} of ${policy.maxActionsPerHour} this hour`, nums)
    : fail("R9", `Rate limit: ${ctx.actionsInLastHour} actions in the last hour (max ${policy.maxActionsPerHour})`, nums);
}

/** R10: exchange filters (exchangeInfo PRICE_FILTER, LOT_SIZE, MARKET_LOT_SIZE, MIN_NOTIONAL). */
function r10(a: Action, ctx: RefereeContext): RuleResult {
  if (a.kind === "cancel" || a.kind === "iso_margin_add") return skip("R10", "No order filters for this action");
  const f = ctx.market?.filters;
  if (!f) return fail("R10", "Exchange filters unavailable for this market", {});
  const size = dec(a.size);
  const problems: string[] = [];
  // Limit orders use LOT_SIZE, market orders MARKET_LOT_SIZE. Stop orders become market orders on
  // trigger; which lot filter the engine applies is not documented, so both are enforced (conservative).
  const lots: Array<{ name: string; step: string; min: string; max: string }> = [];
  const isStop = a.kind === "protective_stop";
  const isMarket = (a.kind === "open" && a.orderType === "market") || a.kind === "partial_close";
  if (!isMarket) lots.push({ name: "LOT_SIZE", step: f.stepSize, min: f.minQty, max: f.maxQty });
  if (isMarket || isStop) lots.push({ name: "MARKET_LOT_SIZE", step: f.marketStepSize, min: f.marketMinQty, max: f.marketMaxQty });
  if (size.lte(0)) problems.push("size must be > 0");
  for (const l of lots) {
    if (!isMultiple(size, dec(l.step))) problems.push(`size ${a.size} not a multiple of ${l.name}.stepSize ${l.step}`);
    if (size.lt(dec(l.min))) problems.push(`size ${a.size} below ${l.name}.minQty ${l.min}`);
    if (size.gt(dec(l.max))) problems.push(`size ${a.size} above ${l.name}.maxQty ${l.max}`);
  }
  const px = a.kind === "open" && a.orderType === "limit" ? a.price : a.kind === "protective_stop" ? a.stopPrice : undefined;
  if (a.kind === "open" && a.orderType === "limit" && !a.price) problems.push("limit order needs a price");
  if (px !== undefined) {
    const p = dec(px);
    if (!isMultiple(p, dec(f.tickSize))) problems.push(`price ${px} not a multiple of tickSize ${f.tickSize}`);
    if (p.lt(dec(f.minPrice)) || p.gt(dec(f.maxPrice))) problems.push(`price ${px} outside [${f.minPrice}, ${f.maxPrice}]`);
  }
  const notionalPx = px ?? ctx.refPrice ?? ctx.markPrice;
  const nums: Record<string, string> = { size: a.size, minNotional: f.minNotional };
  if (!notionalPx) problems.push("no price available for min-notional check");
  else {
    const notional = size.mul(dec(notionalPx));
    nums.notionalUsd = notional.toFixed(2);
    if (notional.lt(dec(f.minNotional))) problems.push(`notional $${notional.toFixed(2)} below MIN_NOTIONAL ${f.minNotional}`);
  }
  return problems.length ? fail("R10", `Exchange filters: ${problems.join("; ")}`, nums) : pass("R10", "Passes exchange filters", nums);
}

/** R11: protective/reduce-only orders are reduce-only, shrink the position, and do not trigger immediately. */
function r11(a: Action, ctx: RefereeContext): RuleResult {
  if (a.kind === "open" || a.kind === "cancel") return skip("R11", "Not a protective order");
  const pos = existing(ctx, a.symbol);
  if (!pos) return fail("R11", `No open ${a.symbol} position to protect`, {});
  const posSize = dec(pos.size);
  if (a.kind === "iso_margin_add") {
    if (pos.marginMode !== "isolated") return fail("R11", "isoMargin add applies to isolated positions only", { marginMode: pos.marginMode });
    return dec(a.amount).gt(0) ? pass("R11", "Isolated margin add", { amount: a.amount }) : fail("R11", "Amount must be > 0", { amount: a.amount });
  }
  const problems: string[] = [];
  const nums: Record<string, string> = { positionSize: pos.size, orderSize: a.size };
  if (!a.reduceOnly) problems.push("order must be reduce-only");
  const closingSide: Side = posSize.gt(0) ? "sell" : "buy";
  if (a.side !== closingSide) problems.push(`side must be ${closingSide} to reduce a ${posSize.gt(0) ? "long" : "short"}`);
  if (dec(a.size).gt(posSize.abs())) problems.push(`size ${a.size} exceeds position ${posSize.abs().toString()}`);
  if (a.kind === "protective_stop") {
    if (!ctx.markPrice) problems.push("mark price missing");
    else {
      const mark = dec(ctx.markPrice), stop = dec(a.stopPrice);
      nums.mark = ctx.markPrice;
      nums.stopPrice = a.stopPrice;
      // Trigger direction (CLAUDE.md §4.5): sell stop triggers when price ≤ stop_price, buy when ≥.
      if (a.side === "sell" && stop.gte(mark)) problems.push(`sell stop ${a.stopPrice} ≥ mark ${ctx.markPrice} would trigger immediately`);
      if (a.side === "buy" && stop.lte(mark)) problems.push(`buy stop ${a.stopPrice} ≤ mark ${ctx.markPrice} would trigger immediately`);
    }
  }
  return problems.length ? fail("R11", `Protective order invalid: ${problems.join("; ")}`, nums) : pass("R11", "Valid reduce-only protective order", nums);
}

/** R12: PAPER always permitted; LIVE needs APEX_MODE=live and, at execution, a human confirmation. */
function r12(ctx: RefereeContext, policy: Policy): RuleResult {
  const nums = { mode: ctx.mode, stage: ctx.stage, liveEnvEnabled: String(ctx.liveEnvEnabled), humanConfirmed: String(ctx.humanConfirmed) };
  if (ctx.mode === "paper") {
    if (ctx.stage === "execute" && policy.requireHumanConfirm && !ctx.humanConfirmed) return fail("R12", "Human confirmation required", nums);
    return pass("R12", "PAPER mode", nums);
  }
  if (!ctx.liveEnvEnabled) return fail("R12", "LIVE requested but APEX_MODE is not 'live'", nums);
  if (ctx.stage === "execute" && !ctx.humanConfirmed) return fail("R12", "LIVE execution requires explicit human confirmation", nums);
  if (ctx.stage === "propose") return warn("R12", "LIVE: will require explicit human confirmation before sending", nums);
  return pass("R12", "LIVE confirmed by human", nums);
}

// ── evaluate ──────────────────────────────────────────────────────────────────

function runRules(action: Action, ctx: RefereeContext, policy: Policy): RuleResult[] {
  if (!ctx.market) {
    return [fail("R6", `Unknown symbol ${action.symbol}`, { symbol: action.symbol })];
  }
  const out: RuleResult[] = [];
  const reduction = isReduction(action);
  if (action.kind === "open") {
    out.push(r1(action, ctx, policy), r2(action, ctx, policy), r3(action, ctx, policy), r4(action, ctx, policy), r5(ctx.liquidation, policy), r6(ctx, policy, action.symbol));
  } else {
    const why = reduction ? "Reduction: allowed past R1–R6" : "Not applicable to cancels";
    for (const id of ["R1", "R2", "R3", "R4", "R5", "R6"] as const) out.push(skip(id, why));
  }
  if (action.kind === "cancel") {
    out.push(skip("R7", "Cancels allowed in any market status"), skip("R8", "Cancels need no market data"));
  } else {
    const marketOrder = (action.kind === "open" && action.orderType === "market") || action.kind === "partial_close";
    out.push(r7(ctx), r8(ctx, { mark: true, depth: marketOrder, account: true }));
  }
  out.push(reduction ? skip("R9", "Reduction: not rate-limited") : r9(ctx, policy));
  out.push(r10(action, ctx), r11(action, ctx), r12(ctx, policy));
  return out;
}

export function evaluate(action: Action, ctx: RefereeContext, policy: Policy): Verdict {
  const checks = runRules(action, ctx, policy);
  const violations = checks.filter((c) => c.status === "fail");
  const warnings = checks.filter((c) => c.status === "warn");
  const verdict: Verdict = { decision: violations.length ? "BLOCK" : "APPROVE", violations, warnings, checks };
  if (action.kind === "open" && violations.some((v) => v.id === "R1" || v.id === "R2" || v.id === "R5")) {
    const alt = generateAlternative(action, ctx, policy);
    if (alt) verdict.alternative = alt;
  }
  return verdict;
}

/**
 * Largest compliant size at the allowed leverage (CLAUDE.md §6.3), respecting step size and min
 * notional. Tries the highest allowed leverage first, then lower ones; returns the first candidate
 * that passes every rule, or undefined.
 */
export function generateAlternative(action: Extract<Action, { kind: "open" }>, ctx: RefereeContext, policy: Policy): Extract<Action, { kind: "open" }> | undefined {
  const f = ctx.market?.filters;
  if (!f || !ctx.liqDistanceAt) return undefined;
  const step = dec(action.orderType === "market" ? f.marketStepSize : f.stepSize);
  const kMax = dec(action.size).div(step).floor().toNumber();
  const top = Math.min(action.leverage, effectiveMaxLeverage(ctx, policy));
  for (let lev = top; lev >= 1; lev--) {
    const candidate = (k: number): Extract<Action, { kind: "open" }> => ({ ...action, leverage: lev, size: step.mul(k).toString() });
    const ok = (k: number) => {
      const c = candidate(k);
      const liq = ctx.liqDistanceAt!(lev, c.size);
      return runRules(c, { ...ctx, liquidation: liq }, policy).every((r) => r.status !== "fail");
    };
    // Bisection on step count: assumes compliance is monotone in size (larger orders only add risk).
    let lo = 0, hi = kMax;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ok(mid)) lo = mid;
      else hi = mid - 1;
    }
    if (lo > 0 && ok(lo)) return candidate(lo);
  }
  return undefined;
}
