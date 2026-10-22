// Mandatory tests from the Borrow-and-Earn doc's own worked examples (CLAUDE.md §6.7).
import { CREDIT_SHARED } from "@apex/config";
import { describe, expect, it } from "vitest";
import { boundaryPrice, completionTargets, conversionPrice, debtRemainderLock, fixAmounts, health, paramsFrom, stressGrid } from "../src/credit.js";
import { D, dec } from "../src/money.js";
import { CreditSettings } from "../src/schemas.js";
import { fixture } from "./fixtures.js";

const settings = CreditSettings.parse(fixture("credit_settings"));
const ADA = paramsFrom(settings.settings.collateral_assets.ADA!, CREDIT_SHARED);

describe("live ADA settings match the doc's example parameters", () => {
  it("M = 1, X = 0.30, d = 0.05, Y = 0.20, F = 0.50, r = 0.05, prec 6", () => {
    expect(ADA.M.toString()).toBe("1");
    expect(ADA.X.toString()).toBe("0.3");
    expect(ADA.d.toString()).toBe("0.05");
    expect([ADA.Y, ADA.F, ADA.r].map(String)).toEqual(["0.2", "0.5", "0.05"]);
    expect(ADA.assetPrec).toBe(6);
  });
});

describe("ADA health examples (D = 400, X = 0.30, Y = 0.20, F = 0.50)", () => {
  const Dt = dec("400");
  const h = (C: string, V: string) => health(dec(C), dec(V), Dt, ADA);
  it("C 400, V 400 → J 0, health 200.00, Active", () => {
    const r = h("400", "400");
    expect(r.J.toString()).toBe("0");
    expect(r.creditHealth.toFixed(2)).toBe("200.00");
    expect(r.state).toBe("ACTIVE");
  });
  it("C 280, V 400 → J 1, health 100.00, Recovery", () => {
    const r = h("280", "400");
    expect(r.J.toString()).toBe("1");
    expect(r.creditHealth.toFixed(2)).toBe("100.00");
    expect(r.state).toBe("RECOVERY");
  });
  it("C 400, V 320 → J 1", () => expect(h("400", "320").J.toString()).toBe("1"));
  it("C 340, V 360 → J 1", () => expect(h("340", "360").J.toString()).toBe("1"));
  it("C 250, V 500 → J 1", () => expect(h("250", "500").J.toString()).toBe("1"));
  it("C 200, V 800 → J 2/3, floor binds, health 100.00, Recovery", () => {
    const r = h("200", "800");
    expect(r.J.toFixed(10)).toBe(new D(2).div(3).toFixed(10));
    expect(r.floorHealth.toFixed(2)).toBe("100.00");
    expect(r.jointHealth.gt(r.floorHealth)).toBe(true);
    expect(r.creditHealth.toFixed(2)).toBe("100.00");
    expect(r.state).toBe("RECOVERY");
  });
});

describe("recovery boundary price", () => {
  it("800 ADA, D 400, V 400 → $0.35 (joint binds)", () => {
    const b = boundaryPrice(dec("800"), dec("400"), dec("400"), ADA);
    expect(b.price.toString()).toBe("0.35");
    expect(b.binds).toBe("joint");
  });
  it("V 360 → $0.425", () => {
    expect(boundaryPrice(dec("800"), dec("360"), dec("400"), ADA).price.toString()).toBe("0.425");
  });
});

describe("completion targets", () => {
  it("ADA J* = 50/57 ≈ 0.877193, F* = 10/19 ≈ 0.526316; thresholds ≈ 112.28 joint, 105.26 floor", () => {
    const t = completionTargets(ADA);
    expect(t.Jstar.toFixed(6)).toBe("0.877193");
    expect(t.Jstar.toFixed(20)).toBe(new D(50).div(57).toFixed(20));
    expect(t.Fstar.toFixed(6)).toBe("0.526316");
    expect(t.Fstar.toFixed(20)).toBe(new D(10).div(19).toFixed(20));
    expect(t.jointHealthTarget.toFixed(2)).toBe("112.28");
    expect(t.floorHealthTarget.toFixed(2)).toBe("105.26");
  });
});

describe("debt-remainder lock and conversion price", () => {
  it("D_r 40, d 0.05, X 0.30, F 0.50, M 1.00 → $60.15037594…, 120.300752 ADA at $0.50", () => {
    const l = debtRemainderLock(dec("40"), dec("0.50"), ADA);
    expect(l.usd.toFixed(8)).toBe("60.15037594");
    expect(l.units.toString()).toBe("120.300752");
  });
  it("P 0.50, d 0.05 → 0.475", () => {
    expect(conversionPrice(dec("0.50"), ADA).toString()).toBe("0.475");
  });
});

describe("fix amounts (minimum repay / extra collateral reaching J ≤ J* and c ≥ F*)", () => {
  // Line at the boundary: 800 ADA at $0.35, D 400, V 400 → J = 1 (Recovery).
  const q = dec("800"), P = dec("0.35"), V = dec("400"), Dt = dec("400");
  const t = completionTargets(ADA);
  const f = fixAmounts(q, P, V, Dt, ADA);
  it("repay amount reaches both targets, rounded up to cents, and one cent less does not", () => {
    const after = (R: string) => health(q.mul(P), V, Dt.sub(dec(R)), ADA);
    expect(f.repayUsd.decimalPlaces()).toBeLessThanOrEqual(2);
    expect(after(f.repayUsd.toString()).J.lte(t.Jstar)).toBe(true);
    const less = f.repayUsd.sub("0.01");
    const h = after(less.toString());
    expect(h.J.lte(t.Jstar) && h.c.gte(t.Fstar)).toBe(false);
  });
  it("extra collateral reaches both targets, rounded up to 6 dp", () => {
    expect(f.addCollateralUnits.decimalPlaces()).toBeLessThanOrEqual(6);
    const h = health(q.add(f.addCollateralUnits).mul(P), V, Dt, ADA);
    expect(h.J.lte(t.Jstar) && h.c.gte(t.Fstar)).toBe(true);
    const less = q.add(f.addCollateralUnits.sub("0.000001")).mul(P);
    const h2 = health(less, V, Dt, ADA);
    expect(h2.J.lte(t.Jstar) && h2.c.gte(t.Fstar)).toBe(false);
  });
  it("a line already past the targets needs no fix", () => {
    expect(fixAmounts(dec("800"), dec("0.5"), dec("400"), dec("400"), ADA)).toMatchObject({ alreadyMeets: true });
  });
});

describe("stress heatmap", () => {
  it("7 × 11 grid, top-left is the current line, recovery cells marked", () => {
    const g = stressGrid(dec("800"), dec("0.5"), dec("345.5"), dec("1.157721"), dec("400"), ADA);
    expect(g.length).toBe(7);
    expect(g[0]!.length).toBe(11);
    expect(g[0]![0]).toMatchObject({ collateralChangePct: -0, vaultDrawdownPct: -0 });
    expect(g[6]![10]!.state).toBe("RECOVERY");
  });
});
