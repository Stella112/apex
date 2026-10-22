import { describe, expect, it } from "vitest";
import { D, dec } from "../src/money.js";
import { DEFAULT_POLICY, type Policy, mergePolicy } from "../src/policy.js";
import { type Action, type LiqEstimate, type RefereeContext, type RuleId, concentrationPct, evaluate } from "../src/referee.js";
import type { ExchangeFilters } from "../src/registry.js";

// Real NVDA-USD filters (fixtures/live/exchangeInfo.json).
const NVDA_FILTERS: ExchangeFilters = {
  tickSize: "0.01", minPrice: "0.01", maxPrice: "20000",
  stepSize: "0.01", minQty: "0.01", maxQty: "30000",
  marketStepSize: "0.01", marketMinQty: "0.01", marketMaxQty: "3000",
  minNotional: "10",
};

function ctx(over: Partial<RefereeContext> = {}): RefereeContext {
  return {
    stage: "propose",
    mode: "paper",
    liveEnvEnabled: false,
    humanConfirmed: false,
    market: { symbol: "NVDA-USD", class: "equity", perpStatus: "ACTIVE", underlying: "open", filters: NVDA_FILTERS },
    markPrice: "212.00",
    dataAgesMs: { mark: 1000, depth: 1000, account: 1000 },
    portfolio: [],
    liquidation: { kind: "value", pct: "30" },
    actionsInLastHour: 0,
    ...over,
  };
}

const open = (over: Partial<Extract<Action, { kind: "open" }>> = {}): Extract<Action, { kind: "open" }> => ({
  kind: "open", symbol: "NVDA-USD", side: "buy", size: "2.00", orderType: "market", leverage: 3, ...over,
});

const longPos = { symbol: "NVDA-USD", size: "2", markPrice: "212.00", marginMode: "cross" as const };
const stop = (over: Partial<Extract<Action, { kind: "protective_stop" }>> = {}): Action => ({
  kind: "protective_stop", symbol: "NVDA-USD", side: "sell", size: "2", stopPrice: "180.00", reduceOnly: true, ...over,
});
const close = (over: Partial<Extract<Action, { kind: "partial_close" }>> = {}): Action => ({
  kind: "partial_close", symbol: "NVDA-USD", side: "sell", size: "1", reduceOnly: true, slippage: "0.01", ...over,
});

const status = (v: ReturnType<typeof evaluate>, id: RuleId) => v.checks.find((c) => c.id === id)?.status;
const P = DEFAULT_POLICY;

describe("default policy", () => {
  it("parses config/policy.default.json", () => {
    expect(P.maxLeverage).toBe(5);
    expect(P.weekend.maxLeverageWhenUnderlyingClosed).toBe(3);
  });
  it("mergePolicy validates and rejects bad input", () => {
    expect(mergePolicy(P, { maxLeverage: 2 }).maxLeverage).toBe(2);
    expect(mergePolicy(P, { weekend: { maxLeverageWhenUnderlyingClosed: 2 } }).weekend).toEqual({ maxLeverageWhenUnderlyingClosed: 2, blockNewPositionsWhenUnderlyingClosed: false });
    expect(() => mergePolicy(P, { maxLeverage: 0 })).toThrow();
    expect(() => mergePolicy(P, { maxPositionNotionalUsd: 500 })).toThrow();
    expect(() => mergePolicy(P, { unknownKey: 1 })).toThrow();
  });
});

describe("baseline", () => {
  it("approves a compliant open", () => {
    const v = evaluate(open(), ctx(), P);
    expect(v.decision).toBe("APPROVE");
    expect(v.violations).toEqual([]);
    expect(v.checks.map((c) => c.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R12"]);
  });
});

describe("R1 leverage", () => {
  it("approves at max, blocks above", () => {
    expect(status(evaluate(open({ leverage: 5 }), ctx(), P), "R1")).toBe("pass");
    expect(status(evaluate(open({ leverage: 6 }), ctx(), P), "R1")).toBe("fail");
  });
  it("uses the closed-session max when the underlying is closed or unknown", () => {
    for (const u of ["closed", "unknown"] as const) {
      const c = ctx({ market: { ...ctx().market!, underlying: u } });
      expect(status(evaluate(open({ leverage: 3 }), c, P), "R1")).toBe("pass");
      expect(status(evaluate(open({ leverage: 4 }), c, P), "R1")).toBe("fail");
    }
  });
  it("blocks new positions when configured and underlying closed", () => {
    const pol = mergePolicy(P, { weekend: { blockNewPositionsWhenUnderlyingClosed: true } });
    const c = ctx({ market: { ...ctx().market!, underlying: "closed" } });
    expect(status(evaluate(open({ leverage: 1 }), c, pol), "R1")).toBe("fail");
    expect(status(evaluate(open({ leverage: 1 }), ctx(), pol), "R1")).toBe("pass");
  });
});

describe("R2 position notional", () => {
  it("approves ≤ $500, blocks above (resulting position incl. existing)", () => {
    expect(status(evaluate(open({ size: "2.35" }), ctx(), P), "R2")).toBe("pass"); // 498.20
    expect(status(evaluate(open({ size: "2.36" }), ctx(), P), "R2")).toBe("fail"); // 500.32
    expect(status(evaluate(open({ size: "1" }), ctx({ portfolio: [longPos] }), P), "R2")).toBe("fail"); // 3 × 212 = 636
  });
});

describe("R3 portfolio notional", () => {
  it("approves ≤ $2000, blocks above", () => {
    const others = [{ symbol: "BTC-USD", size: "0.018", markPrice: "81000", marginMode: "cross" as const }]; // 1458
    expect(status(evaluate(open({ size: "2" }), ctx({ portfolio: others }), P), "R3")).toBe("pass"); // 1882
    expect(status(evaluate(open({ size: "2.35" }), ctx({ portfolio: others }), P), "R3")).toBe("pass"); // 1458 + 498.20 = 1956.20
    expect(status(evaluate(open({ size: "2.6" }), ctx({ portfolio: others }), P), "R3")).toBe("fail"); // 1458 + 551.20 = 2009.20
  });
});

describe("R4 concentration (B3 denominator: max(portfolio, maxPortfolio))", () => {
  it("first trade measured against the allowed book", () => {
    expect(concentrationPct(new D(424), new D(424), P).toFixed(2)).toBe("21.20");
    expect(status(evaluate(open({ size: "2" }), ctx(), P), "R4")).toBe("pass");
  });
  it("blocks when one market exceeds 40% of a book larger than the cap", () => {
    const pol = mergePolicy(P, { maxPositionNotionalUsd: "5000", maxPortfolioNotionalUsd: "5000" });
    const others = [{ symbol: "BTC-USD", size: "0.01", markPrice: "81000", marginMode: "cross" as const }]; // 810
    // NVDA 10 × 212 = 2120; book = 2930 < 5000 cap → 2120/5000 = 42.4% > 40
    expect(status(evaluate(open({ size: "10" }), ctx({ portfolio: others }), pol), "R4")).toBe("fail");
    expect(status(evaluate(open({ size: "9" }), ctx({ portfolio: others }), pol), "R4")).toBe("pass"); // 38.16%
  });
});

describe("R5 liquidation distance", () => {
  it("approves ≥ 15%, blocks below, treats 'none' as pass and 'unavailable' as fail", () => {
    expect(status(evaluate(open(), ctx({ liquidation: { kind: "value", pct: "15" } }), P), "R5")).toBe("pass");
    expect(status(evaluate(open(), ctx({ liquidation: { kind: "value", pct: "14.99" } }), P), "R5")).toBe("fail");
    expect(status(evaluate(open(), ctx({ liquidation: { kind: "none" } }), P), "R5")).toBe("pass");
    expect(status(evaluate(open(), ctx({ liquidation: { kind: "unavailable", reason: "no tiers" } }), P), "R5")).toBe("fail");
  });
});

describe("R6 class and symbol", () => {
  it("blocks disallowed class, blocked symbol, unknown symbol", () => {
    expect(status(evaluate(open(), ctx({ market: { ...ctx().market!, class: "fx" } }), P), "R6")).toBe("fail");
    expect(status(evaluate(open(), ctx({ market: { ...ctx().market!, class: "unknown" } }), P), "R6")).toBe("fail");
    expect(status(evaluate(open(), ctx(), mergePolicy(P, { blockedSymbols: ["NVDA-USD"] })), "R6")).toBe("fail");
    const v = evaluate(open(), ctx({ market: null }), P);
    expect(v.decision).toBe("BLOCK");
    expect(v.violations[0]!.id).toBe("R6");
  });
  it("approves allowed class", () => {
    expect(status(evaluate(open(), ctx(), P), "R6")).toBe("pass");
  });
});

describe("R7 market status", () => {
  it.each(["PRE_TRADING", "BREAK", "CLOSED"])("blocks %s, also for reductions", (s) => {
    const c = ctx({ market: { ...ctx().market!, perpStatus: s }, portfolio: [longPos] });
    expect(status(evaluate(open(), c, P), "R7")).toBe("fail");
    expect(status(evaluate(stop(), c, P), "R7")).toBe("fail");
  });
  it("approves ACTIVE", () => expect(status(evaluate(open(), ctx(), P), "R7")).toBe("pass"));
});

describe("R8 freshness", () => {
  it("blocks stale mark (>15 s), depth (>10 s) for market orders, account (>15 s), and missing data", () => {
    expect(status(evaluate(open(), ctx({ dataAgesMs: { mark: 15_001, depth: 1, account: 1 } }), P), "R8")).toBe("fail");
    expect(status(evaluate(open(), ctx({ dataAgesMs: { mark: 1, depth: 10_001, account: 1 } }), P), "R8")).toBe("fail");
    expect(status(evaluate(open(), ctx({ dataAgesMs: { mark: 1, depth: 1, account: 15_001 } }), P), "R8")).toBe("fail");
    expect(status(evaluate(open(), ctx({ dataAgesMs: { mark: null, depth: 1, account: 1 } }), P), "R8")).toBe("fail");
    expect(status(evaluate(stop(), ctx({ portfolio: [longPos], dataAgesMs: { mark: 16_000, depth: 1, account: 1 } }), P), "R8")).toBe("fail");
  });
  it("approves at the limits; limit orders and stops do not need depth", () => {
    expect(status(evaluate(open(), ctx({ dataAgesMs: { mark: 15_000, depth: 10_000, account: 15_000 } }), P), "R8")).toBe("pass");
    expect(status(evaluate(open({ orderType: "limit", price: "210.00" }), ctx({ dataAgesMs: { mark: 1, depth: null, account: 1 } }), P), "R8")).toBe("pass");
    expect(status(evaluate(stop(), ctx({ portfolio: [longPos], dataAgesMs: { mark: 1, depth: null, account: 1 } }), P), "R8")).toBe("pass");
  });
});

describe("R9 action rate", () => {
  it("approves the 10th action, blocks the 11th; reductions are not rate-limited", () => {
    expect(status(evaluate(open(), ctx({ actionsInLastHour: 9 }), P), "R9")).toBe("pass");
    expect(status(evaluate(open(), ctx({ actionsInLastHour: 10 }), P), "R9")).toBe("fail");
    expect(status(evaluate(stop(), ctx({ actionsInLastHour: 10, portfolio: [longPos] }), P), "R9")).toBe("skipped");
  });
});

describe("R10 exchange filters", () => {
  it("blocks off-step size, below min qty, above market max qty, below min notional, off-tick price", () => {
    expect(status(evaluate(open({ size: "2.005" }), ctx(), P), "R10")).toBe("fail");
    expect(status(evaluate(open({ size: "0.001" }), ctx(), P), "R10")).toBe("fail");
    expect(status(evaluate(open({ size: "3000.01" }), ctx(), mergePolicy(P, { maxPositionNotionalUsd: "10000000", maxPortfolioNotionalUsd: "10000000" })), "R10")).toBe("fail");
    expect(status(evaluate(open({ size: "0.04" }), ctx(), P), "R10")).toBe("fail"); // $8.48 < $10
    expect(status(evaluate(open({ orderType: "limit", price: "210.005" }), ctx(), P), "R10")).toBe("fail");
    expect(status(evaluate(open({ orderType: "limit" }), ctx(), P), "R10")).toBe("fail"); // missing price
  });
  it("blocks when filters are unavailable (fail closed)", () => {
    expect(status(evaluate(open(), ctx({ market: { ...ctx().market!, filters: null } }), P), "R10")).toBe("fail");
  });
  it("approves on-step, on-tick, above min notional; applies to reductions too", () => {
    expect(status(evaluate(open({ size: "0.05" }), ctx(), P), "R10")).toBe("pass"); // $10.60
    expect(status(evaluate(open({ orderType: "limit", price: "210.01" }), ctx(), P), "R10")).toBe("pass");
    expect(status(evaluate(stop({ size: "2.005" }), ctx({ portfolio: [{ ...longPos, size: "3" }] }), P), "R10")).toBe("fail");
  });
});

describe("R11 protective orders", () => {
  const c = ctx({ portfolio: [longPos] });
  it("approves a reduce-only sell stop below mark for a long", () => {
    expect(evaluate(stop(), c, P).decision).toBe("APPROVE");
  });
  it("blocks a stop that would trigger immediately", () => {
    expect(status(evaluate(stop({ stopPrice: "212.00" }), c, P), "R11")).toBe("fail");
    expect(status(evaluate(stop({ stopPrice: "213.00" }), c, P), "R11")).toBe("fail");
    const short = ctx({ portfolio: [{ ...longPos, size: "-2" }] });
    expect(status(evaluate(stop({ side: "buy", stopPrice: "211.99" }), short, P), "R11")).toBe("fail");
    expect(status(evaluate(stop({ side: "buy", stopPrice: "230.00" }), short, P), "R11")).toBe("pass");
  });
  it("blocks non-reduce-only, wrong side, oversize, or no position", () => {
    expect(status(evaluate(stop({ reduceOnly: false }), c, P), "R11")).toBe("fail");
    expect(status(evaluate(stop({ side: "buy", stopPrice: "230.00" }), c, P), "R11")).toBe("fail");
    expect(status(evaluate(stop({ size: "2.01" }), c, P), "R11")).toBe("fail");
    expect(status(evaluate(stop(), ctx(), P), "R11")).toBe("fail");
    expect(status(evaluate(close({ reduceOnly: false }), c, P), "R11")).toBe("fail");
  });
  it("isoMargin add requires an isolated position", () => {
    const iso: Action = { kind: "iso_margin_add", symbol: "NVDA-USD", amount: "50" };
    expect(status(evaluate(iso, c, P), "R11")).toBe("fail");
    expect(evaluate(iso, ctx({ portfolio: [{ ...longPos, marginMode: "isolated" }] }), P).decision).toBe("APPROVE");
  });
});

describe("R12 mode", () => {
  it("PAPER propose passes; PAPER execute needs confirmation when policy requires it", () => {
    expect(status(evaluate(open(), ctx(), P), "R12")).toBe("pass");
    expect(status(evaluate(open(), ctx({ stage: "execute" }), P), "R12")).toBe("fail");
    expect(status(evaluate(open(), ctx({ stage: "execute", humanConfirmed: true }), P), "R12")).toBe("pass");
  });
  it("LIVE needs APEX_MODE=live and a human confirmation at execution", () => {
    expect(status(evaluate(open(), ctx({ mode: "live" }), P), "R12")).toBe("fail");
    expect(status(evaluate(open(), ctx({ mode: "live", liveEnvEnabled: true }), P), "R12")).toBe("warn");
    expect(status(evaluate(open(), ctx({ mode: "live", liveEnvEnabled: true, stage: "execute" }), P), "R12")).toBe("fail");
    expect(status(evaluate(open(), ctx({ mode: "live", liveEnvEnabled: true, stage: "execute", humanConfirmed: true }), P), "R12")).toBe("pass");
  });
  it("LIVE confirmation is required even if the policy disables requireHumanConfirm", () => {
    const pol = mergePolicy(P, { requireHumanConfirm: false });
    expect(status(evaluate(open(), ctx({ mode: "live", liveEnvEnabled: true, stage: "execute" }), pol), "R12")).toBe("fail");
    expect(status(evaluate(open(), ctx({ stage: "execute" }), pol), "R12")).toBe("pass");
  });
});

describe("reductions bypass R1–R6 but not R7, R8, R10, R11, R12", () => {
  it("protective stop is approved even when leverage/notional limits would fail", () => {
    const huge = { ...longPos, size: "20" }; // $4240 notional, over every cap
    const c = ctx({ portfolio: [huge], liquidation: { kind: "value", pct: "2" } });
    const v = evaluate(stop({ size: "20" }), c, P);
    expect(v.decision).toBe("APPROVE");
    for (const id of ["R1", "R2", "R3", "R4", "R5", "R6"] as const) expect(status(v, id)).toBe("skipped");
    expect(evaluate(close({ size: "10" }), c, P).decision).toBe("APPROVE");
  });
});

describe("cancel", () => {
  it("only R12 applies", () => {
    const cancel: Action = { kind: "cancel", symbol: "NVDA-USD", orderId: "123" };
    const v = evaluate(cancel, ctx({ market: { ...ctx().market!, perpStatus: "CLOSED" }, dataAgesMs: { mark: null, depth: null, account: null } }), P);
    expect(v.decision).toBe("APPROVE");
    expect(status(evaluate(cancel, ctx({ mode: "live" }), P), "R12")).toBe("fail");
  });
});

describe("alternative generator", () => {
  // Toy liquidation model for the test only: distance shrinks with leverage (≈ 100/lev − 2 %).
  const liqAt = (lev: number): LiqEstimate => ({ kind: "value", pct: dec(100).div(lev).sub(2).toString() });

  it("demo scene: $1,000 NVDA long at 10x → blocked by R1/R2/R5 (and R4: 49.9% of the $2,000 book) with a compliant alternative", () => {
    const action = open({ size: "4.71", leverage: 10 }); // ≈ $998.52
    const c = ctx({ liquidation: liqAt(10), liqDistanceAt: (lev) => liqAt(lev) });
    const v = evaluate(action, c, P);
    expect(v.decision).toBe("BLOCK");
    expect(v.violations.map((x) => x.id).sort()).toEqual(["R1", "R2", "R4", "R5"]);
    expect(v.alternative).toBeDefined();
    const alt = v.alternative as Extract<Action, { kind: "open" }>;
    expect(alt.leverage).toBe(5);
    expect(alt.size).toBe("2.35"); // floor(500 / 212, 0.01)
    const re = evaluate(alt, { ...c, liquidation: liqAt(5) }, P);
    expect(re.decision).toBe("APPROVE");
  });

  it("drops leverage further when the closed-session cap applies", () => {
    const c = ctx({ market: { ...ctx().market!, underlying: "closed" }, liquidation: liqAt(10), liqDistanceAt: (lev) => liqAt(lev) });
    const alt = evaluate(open({ size: "4.71", leverage: 10 }), c, P).alternative as Extract<Action, { kind: "open" }>;
    expect(alt.leverage).toBe(3);
  });

  it("lowers leverage until R5 passes", () => {
    const strict = mergePolicy(P, { minLiquidationDistancePct: "30" }); // needs lev ≤ 3 under the toy model
    const c = ctx({ liquidation: liqAt(5), liqDistanceAt: (lev) => liqAt(lev) });
    const alt = evaluate(open({ leverage: 5 }), c, strict).alternative as Extract<Action, { kind: "open" }>;
    expect(alt.leverage).toBe(3);
  });

  it("returns no alternative when nothing compliant exists (below min notional)", () => {
    const pol: Policy = mergePolicy(P, { maxPositionNotionalUsd: "5" });
    const c = ctx({ liquidation: liqAt(10), liqDistanceAt: (lev) => liqAt(lev) });
    expect(evaluate(open({ leverage: 10 }), c, pol).alternative).toBeUndefined();
  });

  it("is not generated for R3/R4-only blocks", () => {
    const others = [{ symbol: "BTC-USD", size: "0.02", markPrice: "81000", marginMode: "cross" as const }];
    const v = evaluate(open(), ctx({ portfolio: others, liqDistanceAt: (lev) => liqAt(lev) }), P);
    expect(v.violations.map((x) => x.id)).toContain("R3");
    expect(v.alternative).toBeUndefined();
  });
});
