import { sessionFor } from "@apex/config";
import { describe, expect, it } from "vitest";
import { alignedWeekdayReturns, fairValue, ols, referenceFor } from "../src/fairvalue.js";
import type { Kline } from "../src/schemas.js";

const HOUR = 3600_000;
// Mon 2026-10-19 00:00 UTC
const T0 = Date.parse("2026-10-19T00:00:00Z");

function series(n: number, f: (i: number) => number): Kline[] {
  return Array.from({ length: n }, (_, i) => {
    const p = f(i).toFixed(6);
    return { openTime: T0 + i * HOUR, open: p, high: p, low: p, close: p, volume: "0", closeTime: T0 + (i + 1) * HOUR - 1 };
  });
}

describe("OLS", () => {
  it("recovers β and R² on an exact linear relation", () => {
    const x = Array.from({ length: 50 }, (_, i) => Math.sin(i) / 100);
    const y = x.map((v) => 2 * v + 0.0001);
    const r = ols(x, y)!;
    expect(r.beta).toBeCloseTo(2, 9);
    expect(r.r2).toBeCloseTo(1, 9);
    expect(r.residSigma).toBeLessThan(1e-9);
  });
  it("needs at least 30 samples", () => {
    expect(ols([1, 2], [1, 2])).toBeNull();
  });
});

describe("reference index", () => {
  it("equities → NAS100; NAS100 ↔ SP500; commodities none", () => {
    expect(referenceFor("NVDA-USD", "equity")).toBe("NAS100-USD");
    expect(referenceFor("NAS100-USD", "index")).toBe("SP500-USD");
    expect(referenceFor("SP500-USD", "index")).toBe("NAS100-USD");
    expect(referenceFor("XAU-USD", "commodity")).toBeNull();
  });
});

describe("fair value", () => {
  // Reference wiggles; stock = 1.5 × reference returns + small noise, over 5 weekdays + weekend.
  const ref = series(24 * 8, (i) => 20000 * (1 + 0.004 * Math.sin(i / 3) + 0.0005 * i / 24));
  const noise = (i: number) => 0.0004 * Math.cos(i * 7.3);
  const stk = series(24 * 8, (i) => 200 * (1 + 1.5 * (0.004 * Math.sin(i / 3) + 0.0005 * i / 24) + noise(i)));
  const nvda = sessionFor("NVDA-USD")!;
  it("aligned weekday returns skip weekend hours", () => {
    const { x, y } = alignedWeekdayReturns(stk, ref);
    expect(x.length).toBe(y.length);
    expect(x.length).toBeLessThan(24 * 8 - 1);
  });
  it("while the underlying is closed: implied price, band, β ≈ 1.5", () => {
    const now = Date.parse("2026-10-24T18:00:00Z"); // Saturday
    const f = fairValue("NVDA-USD", "equity", nvda, "205", "20300", stk, ref, now);
    expect(f.status).toBe("OK");
    expect(Number(f.beta)).toBeGreaterThan(1.2);
    expect(Number(f.r2)).toBeGreaterThan(0.2);
    expect(Number(f.bandLow)).toBeLessThan(Number(f.implied));
    expect(Number(f.bandHigh)).toBeGreaterThan(Number(f.implied));
    expect(f.label).toBe("ESTIMATE");
    expect(f.lastCloseAt).toBe("2026-10-23T20:00:00.000Z"); // Fri 16:00 ET
  });
  it("underlying open → no band; low R² → no reliable band; unknown session → none", () => {
    const open = Date.parse("2026-10-22T15:00:00Z"); // Thu 11:00 ET
    expect(fairValue("NVDA-USD", "equity", nvda, "205", "20300", stk, ref, open).status).toBe("UNDERLYING_OPEN");
    const unrelated = series(24 * 8, (i) => 200 * (1 + 0.003 * Math.cos(i * 1.7)));
    expect(fairValue("NVDA-USD", "equity", nvda, "205", "20300", unrelated, ref, Date.parse("2026-10-24T18:00:00Z")).status).toBe("NO_RELIABLE_BAND");
    expect(fairValue("SKHYNIX-USD", "equity", sessionFor("SKHYNIX-USD"), "900", "20300", stk, ref, 0).status).toBe("NO_SESSION");
  });
});
