import { sessionFor } from "@apex/config";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { CircuitData } from "../src/circuit.js";
import { derive, liqAndBankruptcy } from "../src/margin.js";
import { D, dec } from "../src/money.js";
import { DEFAULT_POLICY } from "../src/policy.js";
import { mergeMarkets } from "../src/registry.js";
import { Depth, ExchangeInfo, FeeTiers, type Kline, Klines, MarketStats, Markets } from "../src/schemas.js";
import {
  band, bookDepthUsd, closedWindows, flagsFor, gapDistribution, isoMarginAddFor, isStaleMark, normCdf, pGap, protectiveStopPrice, windowReturns,
} from "../src/shield.js";
import { type PositionInputView, positionGapRisk } from "../src/shield-report.js";
import { fixture } from "./fixtures.js";

const et = (iso: string) => DateTime.fromISO(iso, { zone: "America/New_York" }).toMillis();
const nvda = sessionFor("NVDA-USD")!;
const klines: Kline[] = Klines.parse(fixture("klines_NVDA-USD_1h_mark")).map((r) => ({ openTime: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], closeTime: r[6] }));
const markets = Markets.parse(fixture("markets")).markets;

describe("closed windows", () => {
  it("one week of NYSE sessions → 4 overnight windows (17.5h) + the weekend (65.5h)", () => {
    const w = closedWindows(nvda, et("2026-10-19T00:00"), et("2026-10-26T23:00"));
    const hours = w.map((x) => x.hours);
    expect(hours.slice(0, 5)).toEqual([17.5, 17.5, 17.5, 17.5, 65.5]);
  });
  it("Thanksgiving week: Wed close → Fri open = 41.5h; Fri 13:00 early close → Mon = 68.5h", () => {
    const w = closedWindows(nvda, et("2026-11-23T00:00"), et("2026-12-01T00:00")).map((x) => x.hours);
    expect(w).toContain(41.5);
    expect(w).toContain(68.5);
  });
});

describe("historical closed-window returns (live NVDA fixture)", () => {
  const rets = windowReturns(klines, nvda);
  it("has enough samples for the EMPIRICAL method", () => {
    expect(rets.length).toBeGreaterThanOrEqual(8);
    for (const r of rets) expect(r.open).toBeGreaterThan(r.close);
    const dist = gapDistribution(nvda, klines, et("2026-10-22T15:00"));
    expect(dist.method).toBe("EMPIRICAL");
    expect(dist.samples).toBe(rets.length);
    expect(dist.windowHours).toBe(17.5); // Thu close → Fri open
  });
  it("crypto → N/A; unknown session → MODELED with the conservative 65.5h window", () => {
    expect(gapDistribution(undefined, klines, 0).method).toBe("N/A");
    const u = gapDistribution(sessionFor("SKHYNIX-USD"), klines, et("2026-10-22T15:00"));
    expect(u.method).toBe("MODELED");
    expect(u.windowHours).toBe(65.5);
    expect(u.sigmaHourly).toBeGreaterThan(0);
  });
  it("falls back to MODELED when fewer than 8 windows exist", () => {
    const short = klines.slice(-48);
    expect(gapDistribution(nvda, short, et("2026-10-22T15:00")).method).toBe("MODELED");
  });
});

describe("p_gap and bands", () => {
  const emp = { method: "EMPIRICAL" as const, samples: 10, returns: [-0.2, -0.1, -0.05, 0, 0, 0.01, 0.02, 0.05, 0.1, 0.3], sigmaHourly: null, windowHours: 17.5, note: "" };
  it("empirical frequency of adverse moves ≥ d", () => {
    expect(pGap(emp, "long", 0.1)).toBe(0.2);
    expect(pGap(emp, "short", 0.1)).toBe(0.2);
    expect(pGap(emp, "short", 0.25)).toBe(0.1);
  });
  it("modeled log-normal tail", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 6);
    const mod = { method: "MODELED" as const, samples: 0, returns: [], sigmaHourly: 0.01, windowHours: 1, note: "" };
    const d = 1 - Math.exp(-1.959964 * 0.01); // ln(1−d) = −1.96σ
    expect(pGap(mod, "long", d)).toBeCloseTo(0.025, 5);
  });
  it("bands: LOW < 5%, MEDIUM 5–20%, HIGH > 20%", () => {
    expect(band(0.049)).toBe("LOW");
    expect(band(0.05)).toBe("MEDIUM");
    expect(band(0.2)).toBe("MEDIUM");
    expect(band(0.2001)).toBe("HIGH");
    expect(band(null)).toBe("N/A");
  });
});

describe("flags", () => {
  it("STALE_MARK on flat candles only", () => {
    const flat = (p: string, t: number): Kline => ({ openTime: t, open: p, high: p, low: p, close: p, volume: "0", closeTime: t + 3599999 });
    expect(isStaleMark([flat("10", 0), flat("10", 1), flat("10", 2)])).toBe(true);
    expect(isStaleMark(klines)).toBe(false);
  });
  it("THIN_BOOK from live NVDA depth within ±1% of mark; UNDERLYING_UNKNOWN for unknown sessions", () => {
    const depth = Depth.parse(fixture("depth_NVDA-USD"));
    const mark = dec(markets["NVDA-USD"]!.mark_price);
    const { bidUsd, askUsd } = bookDepthUsd(depth, mark);
    expect(bidUsd.gt(0) && askUsd.gt(0)).toBe(true);
    const thin = D.min(bidUsd, askUsd).lt(10000);
    expect(flagsFor(nvda, false, klines, depth, mark).includes("THIN_BOOK")).toBe(thin);
    expect(flagsFor(sessionFor("ZHIPU-USD"), false, [], null, null)).toEqual(["UNDERLYING_UNKNOWN"]);
    expect(flagsFor(undefined, true, [], null, null)).toEqual([]);
  });
});

describe("protection math", () => {
  it("stop sits min-distance beyond liquidation, or halfway when closer, never at/through mark", () => {
    expect(protectiveStopPrice("long", dec("200"), dec("150"), dec("15"), dec("0.01"))!.toString()).toBe("172.5");
    expect(protectiveStopPrice("long", dec("200"), dec("190"), dec("15"), dec("0.01"))!.toString()).toBe("195");
    expect(protectiveStopPrice("short", dec("200"), dec("250"), dec("15"), dec("0.01"))!.toString()).toBe("225");
    expect(protectiveStopPrice("long", dec("200"), dec("0"), dec("15"), dec("0.01"))).toBeNull();
  });
  it("isoMargin add inverts the LP formula", () => {
    const tiers = markets["NVDA-USD"]!.margin_tiers;
    const size = dec("2"), entry = dec("212"), mark = dec("212");
    const target = dec("170");
    const add = isoMarginAddFor(size, entry, mark, 10, dec("42.4"), target, tiers, 8);
    const d = derive(size, entry, 10, mark, tiers, 8);
    const { lp } = liqAndBankruptcy(size, entry, d, tiers, { W: dec("42.4").add(add), upnl: d.upnl, mm: d.mm, count: 1 });
    expect(lp.lte(target)).toBe(true);
    expect(target.sub(lp).lt("0.01")).toBe(true);
  });
});

describe("position gap risk end-to-end (fixtures)", () => {
  const now = et("2026-10-23T15:00"); // Friday afternoon, weekend ahead
  const reg = mergeMarkets(ExchangeInfo.parse(fixture("exchangeInfo")), MarketStats.parse(fixture("marketStats")).data, now, now);
  const mark = markets["NVDA-USD"]!.mark_price;
  const pos: PositionInputView = { symbol: "NVDA-USD", size: "2", entry_price: mark, leverage: 20, margin_mode: "isolated", iso_balance: dec(mark).mul(2).div(20).toFixed(2), liquidation_price: dec(mark).mul("0.96").toFixed(2) };
  const data: CircuitData = {
    now, mode: "paper", liveEnvEnabled: false, market: reg.markets.find((m) => m.symbol === "NVDA-USD"), markets, marketsFetchedAt: now - 1000,
    depth: Depth.parse(fixture("depth_NVDA-USD")), depthFetchedAt: now - 1000, feeTiers: FeeTiers.parse(fixture("fee-tiers")),
    account: { source: "PAPER", walletBalance: "1000", positions: [pos], marginModeFor: () => "isolated", fetchedAt: now - 1000 }, actionsInLastHour: 0,
  };
  // Deterministic HIGH-risk distribution: 3 of 10 windows move ≥ 4% against a long.
  const dist = { method: "EMPIRICAL" as const, samples: 10, returns: [-0.08, -0.06, -0.045, -0.01, 0, 0, 0.01, 0.02, 0.03, 0.05], sigmaHourly: 0.005, windowHours: 65.5, note: "synthetic" };
  const r = positionGapRisk(pos, [pos], {
    policy: DEFAULT_POLICY, circuitData: data, registry: (s) => reg.markets.find((m) => m.symbol === s),
    dist: () => dist, flags: () => [], positionsLabel: "PAPER",
  });

  it("live NVDA history: worst close→open move is small, so a 4% distance scores LOW", () => {
    const live = gapDistribution(sessionFor("NVDA-USD"), klines, now);
    expect(live.samples).toBeGreaterThanOrEqual(8);
    expect(band(pGap(live, "long", 0.04))).toBe("LOW");
  });

  it("scores a 4%-from-liquidation 20x long with method and samples", () => {
    expect(r.side).toBe("long");
    expect(r.method).toBe("EMPIRICAL");
    expect(r.samples).toBe(10);
    expect(Number(r.liquidationDistancePct)).toBeCloseTo(4, 0);
    expect(r.pGapPct).not.toBeNull();
  });

  it("HIGH → stop and isoMargin proposals that pass the referee and restore a LOW band", () => {
    expect(r.band).toBe("HIGH");
    expect(r.pGapPct).toBe("30.0");
    const kinds = r.suggestions.map((s) => s.kind);
    expect(kinds).toContain("protective_stop");
    expect(kinds).toContain("iso_margin_add");
    for (const s of r.suggestions) expect(s.verdict.decision).toBe("APPROVE");
    const iso = r.suggestions.find((s) => s.kind === "iso_margin_add")!;
    expect(iso.after.band).toBe("LOW");
    expect(Number(iso.after.distancePct)).toBeGreaterThanOrEqual(15);
  });
});
