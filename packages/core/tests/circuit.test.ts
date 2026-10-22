import { describe, expect, it } from "vitest";
import { type CircuitData, runCircuit, walkDepth } from "../src/circuit.js";
import { accountLiquidations, compareLiquidations, derive, liqAndBankruptcy, tierIndexByLeverage, tierIndexByNotional } from "../src/margin.js";
import { D, dec } from "../src/money.js";
import { DEFAULT_POLICY } from "../src/policy.js";
import { mergeMarkets } from "../src/registry.js";
import { Balances, Depth, ExchangeInfo, FeeTiers, MarketStats, Markets, Positions } from "../src/schemas.js";
import { fixture } from "./fixtures.js";

const markets = Markets.parse(fixture("markets")).markets;
const nvdaTiers = markets["NVDA-USD"]!.margin_tiers;

describe("margin tiers (strike-calculations)", () => {
  it("tier by notional: boundary stays in the lower tier; above last → last", () => {
    expect(tierIndexByNotional(nvdaTiers, dec("50000"))).toBe(0);
    expect(tierIndexByNotional(nvdaTiers, dec("50000.01"))).toBe(1);
    expect(tierIndexByNotional(nvdaTiers, dec("1e12"))).toBe(nvdaTiers.length - 1);
  });
  it("tier by leverage: highest index with leverage ≤ max_leverage", () => {
    expect(tierIndexByLeverage(nvdaTiers, 20)).toBe(1);
    expect(tierIndexByLeverage(nvdaTiers, 5)).toBe(7);
    expect(() => tierIndexByLeverage(nvdaTiers, 21)).toThrow();
  });
});

describe("liquidation formula", () => {
  it("isolated long, hand-computed: (212 − 84.8/2)/(1 − 0.01) = 171.3131…", () => {
    const size = dec("2"), entry = dec("212");
    const d = derive(size, entry, 5, dec("212"), nvdaTiers, 8);
    expect(d.notional.toString()).toBe("424");
    expect(d.im.toString()).toBe("84.8");
    expect(d.mm.toString()).toBe("4.24");
    const { lp, bp } = liqAndBankruptcy(size, entry, d, nvdaTiers, { W: dec("84.8"), upnl: d.upnl, mm: d.mm, count: 1 });
    expect(lp.toFixed(6)).toBe(new D("169.6").div("0.99").toFixed(6));
    expect(bp.toString()).toBe("169.6");
  });
  it("isolated short mirrors with (1 + MMR)", () => {
    const size = dec("-2"), entry = dec("212");
    const d = derive(size, entry, 5, dec("212"), nvdaTiers, 8);
    const { lp } = liqAndBankruptcy(size, entry, d, nvdaTiers, { W: dec("84.8"), upnl: d.upnl, mm: d.mm, count: 1 });
    expect(lp.toFixed(6)).toBe(new D("254.4").div("1.01").toFixed(6));
  });
  it("VALIDATION: matches Strike's liquidation_price within 1% for every live SLP vault position", () => {
    const pos = Positions.parse(fixture("positions_vault_slp")).positions;
    const bal = Balances.parse(fixture("balances_vault_slp"))[0]!;
    const mm = Object.fromEntries(Object.entries(markets).map(([k, m]) => [k, { tiers: m.margin_tiers, quotePrec: m.quote_prec, mark: m.mark_price }]));
    const checks = compareLiquidations(accountLiquidations(pos, mm, dec(bal.walletBalance)), pos);
    expect(checks.length).toBe(pos.length);
    expect(checks.filter((c) => !c.match)).toEqual([]);
  });
});

describe("depth walk", () => {
  const depth = Depth.parse(fixture("depth_NVDA-USD"));
  it("fills from best ask upward and reports the average", () => {
    const best = dec(depth.asks[0]![0]);
    const w = walkDepth(depth, "buy", dec(depth.asks[0]![1]));
    expect(w.avgPrice!.toString()).toBe(best.toString());
    expect(w.levelsUsed).toBe(1);
    const big = walkDepth(depth, "buy", dec(depth.asks[0]![1]).add(dec(depth.asks[1]![1])));
    expect(big.avgPrice!.gt(best)).toBe(true);
  });
  it("flags insufficient depth", () => {
    expect(walkDepth(depth, "sell", dec("1e9")).insufficient).toBe(true);
  });
});

function nvdaData(over: Partial<CircuitData> = {}): CircuitData {
  const info = ExchangeInfo.parse(fixture("exchangeInfo"));
  const stats = MarketStats.parse(fixture("marketStats")).data;
  const now = 1_792_697_300_000; // Thu 2026-10-22 ~15:28 ET (US session open)
  const reg = mergeMarkets(info, stats, now, now);
  return {
    now,
    mode: "paper",
    liveEnvEnabled: false,
    market: reg.markets.find((m) => m.symbol === "NVDA-USD"),
    markets,
    marketsFetchedAt: now - 1000,
    depth: Depth.parse(fixture("depth_NVDA-USD")),
    depthFetchedAt: now - 1000,
    feeTiers: FeeTiers.parse(fixture("fee-tiers")),
    account: null,
    actionsInLastHour: 0,
    ...over,
  };
}

describe("Circuit report", () => {
  it("demo: $1,000 NVDA long at 10x is blocked and offers a compliant alternative with its own numbers", () => {
    const r = runCircuit({ symbol: "NVDA-USD", side: "buy", notionalUsd: "1000", leverage: 10, orderType: "market" }, nvdaData(), DEFAULT_POLICY);
    expect(r.verdict.decision).toBe("BLOCK");
    const ids = r.verdict.violations.map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(["R1", "R2", "R5"]));
    expect(r.liquidation.marginMode).toBe("isolated");
    expect(dec(r.liquidation.distancePct.value!).lt(15)).toBe(true); // ~9% at 10x
    expect(r.alternativeReport).toBeDefined();
    expect(r.alternativeReport!.verdict.decision).toBe("APPROVE");
    expect(r.alternativeReport!.leverage).toBeLessThanOrEqual(5);
    expect(dec(r.alternativeReport!.notionalUsd.value!).lte(500)).toBe(true);
    expect(dec(r.alternativeReport!.liquidation.distancePct.value!).gte(15)).toBe(true);
  });

  it("labels every number and names its basis", () => {
    const r = runCircuit({ symbol: "NVDA-USD", side: "buy", notionalUsd: "400", leverage: 3, orderType: "market", stopLoss: "200", takeProfit: "230", customMovePct: "12" }, nvdaData(), DEFAULT_POLICY);
    const nums = [r.size, r.notionalUsd, r.entryPrice, r.markPrice, r.liquidation.price, r.fees.takerRate, r.fees.openCostUsd, r.slippage.avgFill, r.funding.hourlyRate, ...r.stress.map((s) => s.pnlUsd)];
    for (const n of nums) {
      expect(["LIVE", "ESTIMATE", "SCENARIO", "PAPER"]).toContain(n.label);
      expect(n.basis.length).toBeGreaterThan(0);
    }
    expect(r.markPrice.label).toBe("LIVE");
    expect(r.stress.map((s) => s.movePct)).toEqual(["2", "5", "8", "12"]);
    expect(r.stress.every((s) => s.pnlUsd.label === "SCENARIO" && dec(s.pnlUsd.value!).lt(0))).toBe(true);
    expect(dec(r.riskReward!.lossUsd.value!).lt(0)).toBe(true);
    expect(dec(r.riskReward!.gainUsd.value!).gt(0)).toBe(true);
    expect(r.verdict.decision).toBe("APPROVE");
  });

  it("fees use the live tier-0 rates (taker 0.0005, maker −0.00005)", () => {
    const r = runCircuit({ symbol: "NVDA-USD", side: "buy", size: "1", leverage: 2, orderType: "market" }, nvdaData(), DEFAULT_POLICY);
    expect(r.fees.takerRate.value).toBe("0.0005");
    expect(r.fees.makerRate.value).toBe("-0.00005");
    expect(dec(r.fees.openCostUsd.value!).toFixed(4)).toBe(dec(r.notionalUsd.value!).mul("0.0005").toFixed(4));
  });

  it("stale mark: still shows numbers, marks STALE, and blocks via R8", () => {
    const d = nvdaData();
    const r = runCircuit({ symbol: "NVDA-USD", side: "buy", size: "1", leverage: 2, orderType: "market" }, { ...d, marketsFetchedAt: d.now - 20_000 }, DEFAULT_POLICY);
    expect(r.stale.stale).toBe(true);
    expect(r.markPrice.value).not.toBeNull();
    expect(r.verdict.violations.map((v) => v.id)).toContain("R8");
  });

  it("funding sign: positive rate → long pays (+), short receives (−)", () => {
    const d = nvdaData();
    const withRate = { ...d, markets: { ...d.markets, "NVDA-USD": { ...d.markets["NVDA-USD"]!, funding_rate: "0.0000125" } } };
    const long = runCircuit({ symbol: "NVDA-USD", side: "buy", size: "1", leverage: 2, orderType: "market" }, withRate, DEFAULT_POLICY);
    const short = runCircuit({ symbol: "NVDA-USD", side: "sell", size: "1", leverage: 2, orderType: "market" }, withRate, DEFAULT_POLICY);
    expect(dec(long.funding.costPerHourUsd.value!).gt(0)).toBe(true);
    expect(dec(short.funding.costPerHourUsd.value!).lt(0)).toBe(true);
  });

  it("cross account: uses the wallet, so liquidation is far for a well-funded account", () => {
    const d = nvdaData({
      account: { source: "LIVE", walletBalance: "10000", positions: [], marginModeFor: () => "cross", fetchedAt: 1_792_697_299_000 },
    });
    const r = runCircuit({ symbol: "NVDA-USD", side: "buy", size: "1", leverage: 5, orderType: "market" }, d, DEFAULT_POLICY);
    expect(r.liquidation.marginMode).toBe("cross");
    expect(r.liquidation.price.value).toBe("0 (none)"); // wallet covers the whole position
  });

  it("reports Strike's leverage limit as an exchange warning", () => {
    const r = runCircuit({ symbol: "NVDA-USD", side: "buy", size: "1", leverage: 25, orderType: "market" }, nvdaData(), DEFAULT_POLICY);
    expect(r.exchangeWarnings.join(" ")).toMatch(/market max 20x/);
  });
});
