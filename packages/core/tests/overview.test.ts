import { describe, expect, it } from "vitest";
import { fakeApex } from "./fake-strike.js";

describe("dashboard-facing service additions", () => {
  it("simulateTrade attaches the Weekend Shield p_gap for the simulated position", async () => {
    const { apex } = fakeApex();
    const r = await apex.simulateTrade({ symbol: "NVDA-USD", side: "buy", notionalUsd: "1000", leverage: 10, orderType: "market" }, "none");
    expect(r.weekend.gap).not.toBeNull();
    expect(r.weekend.gap!.method).toBe("EMPIRICAL");
    expect(r.weekend.gap!.pGap).toMatch(/^\d+\.\d$/);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(r.weekend.gap!.band);
    expect(r.alternativeReport?.weekend.gap?.pGap).toBeDefined();
    expect(r.portfolio.accountSource).toMatch(/no account data/);
  });

  it("weekend report can skip logging (dashboard views are not decisions)", async () => {
    const { apex } = fakeApex();
    const before = apex.decisionLog(1000).length;
    const r = await apex.weekendRiskReport("vault", { log: false });
    expect(r.logSeq).toBeNull();
    expect(apex.decisionLog(1000).length).toBe(before);
    const logged = await apex.weekendRiskReport("vault");
    expect(logged.logSeq).toBe(before + 1);
  });

  it("gap stats are cached for 60 s", async () => {
    const { apex, calls, advance } = fakeApex();
    await apex.marketGapStatsAll();
    const n = calls.length;
    await apex.marketGapStatsAll();
    expect(calls.length).toBe(n);
    advance(61_000);
    await apex.marketGapStatsAll();
    expect(calls.length).toBeGreaterThan(n);
  });

  it("liquidation validation on the public vault matches Strike for every position", async () => {
    const { apex } = fakeApex();
    const checks = await apex.validateLiquidations("vault");
    expect(checks.length).toBe(33);
    expect(checks.every((c) => c.match)).toBe(true);
  });

  it("mark history returns the last 96 hourly closes", async () => {
    const { apex } = fakeApex();
    const h = await apex.markHistory("NVDA-USD");
    expect(h.closes.length).toBe(96);
  });
});
