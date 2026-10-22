import { describe, expect, it } from "vitest";
import { dec } from "../src/money.js";
import { MANDATE, drawdownPct, mandatePolicy, reversionSignal } from "../src/vault.js";
import { fakeApex } from "./fake-strike.js";

const base = { symbol: "NVDA-USD", underlying: "closed" as const, minutesToOpen: 600, fvStatus: "OK", implied: "200", halfWidthPct: "0.6", mark: "200" };

describe("mandate", () => {
  it("is published, PAPER, and converts to a valid referee policy", () => {
    expect(MANDATE.mode).toBe("PAPER");
    const p = mandatePolicy(MANDATE);
    expect(p.maxLeverage).toBe(MANDATE.maxLeverage);
    expect(p.maxPortfolioNotionalUsd).toBe(MANDATE.maxExposureUsd);
    expect(p.weekend.maxLeverageWhenUnderlyingClosed).toBe(MANDATE.maxLeverage);
  });
  it("drawdown from peak", () => {
    expect(drawdownPct(dec("900"), dec("1000")).toString()).toBe("10");
    expect(drawdownPct(dec("1100"), dec("1000")).toString()).toBe("0");
  });
});

describe("reversion signal", () => {
  it("no trade inside k × half-width (1.5 × 0.6% = 0.9%)", () => {
    expect(reversionSignal({ ...base, mark: "201.7" }, MANDATE).kind).toBe("none");
  });
  it("short when the mark is above the band, long when below", () => {
    const up = reversionSignal({ ...base, mark: "202" }, MANDATE);
    expect(up).toMatchObject({ kind: "enter", side: "sell" });
    expect(reversionSignal({ ...base, mark: "198" }, MANDATE)).toMatchObject({ kind: "enter", side: "buy" });
  });
  it("never trades with the underlying open, close to the open, or without a reliable band", () => {
    expect(reversionSignal({ ...base, mark: "210", underlying: "open" }, MANDATE).kind).toBe("none");
    expect(reversionSignal({ ...base, mark: "210", minutesToOpen: 10 }, MANDATE).kind).toBe("none");
    expect(reversionSignal({ ...base, mark: "210", fvStatus: "NO_RELIABLE_BAND", implied: null }, MANDATE).kind).toBe("none");
  });
});

describe("vault tick (fixtures, US session open)", () => {
  it("logs a decision per allowed symbol with template reasoning, trades nothing while the underlying is open", async () => {
    const { apex } = fakeApex();
    const r = await apex.vaultTick();
    expect(r.label).toBe("PAPER");
    expect(r.decisions.length).toBe(MANDATE.allowedSymbols.length);
    expect(r.decisions.every((d) => d.outcome === "no_signal")).toBe(true);
    expect(r.decisions[0]!.reasoning).toMatch(/^No trade: underlying open/);
    expect(apex.vaultDecisions().length).toBe(MANDATE.allowedSymbols.length);
    expect(r.status.equityUsd).toBe("1000.00");
    expect(apex.verifyLog().ok).toBe(true);
  });
});

describe("vault tick with signals (fixtures, Saturday, stubbed fair value)", () => {
  it("opens PAPER reversion trades through Circuit + referee until the exposure cap blocks", async () => {
    const sat = Date.parse("2026-10-24T16:00:00Z");
    const { apex } = fakeApex({ now: () => sat });
    // Implied 3% below every mark with a 0.5% half-width → short signals everywhere.
    apex.fairValue = async (symbol: string) => {
      const m = (await apex.markets()).find((x) => x.symbol === symbol)!;
      const implied = dec(m.stats.markPrice).mul("0.97").toString();
      return { symbol, reference: "NAS100-USD", status: "OK", label: "ESTIMATE", beta: "1.2", r2: "0.5", samples: 500, lastCloseAt: null, markAtClose: null, referenceReturnSinceClosePct: "0", hoursSinceClose: "20", implied, bandLow: null, bandHigh: null, bandHalfWidthPct: "0.5", mark: m.stats.markPrice, deviationPct: "3", note: "stub" };
    };
    const r = await apex.vaultTick();
    const opened = r.decisions.filter((d) => d.outcome === "opened");
    const blocked = r.decisions.filter((d) => d.outcome === "blocked");
    expect(opened.length).toBeGreaterThanOrEqual(1);
    expect(opened.length).toBeLessThanOrEqual(3); // $900 exposure ÷ $300 per position
    expect(opened[0]!.reasoning).toMatch(/revert short/);
    expect(opened[0]!.checks!.some((c) => c.startsWith("R3 pass"))).toBe(true);
    expect(blocked.some((d) => /R3|R2/.test(d.reasoning))).toBe(true);
    expect(r.status.positions.length).toBe(opened.length);
    expect(r.status.positions.every((p) => p.size.startsWith("-"))).toBe(true);
    expect(apex.verifyLog().ok).toBe(true);
  });
});
