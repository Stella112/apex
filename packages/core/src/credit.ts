// Credit Line Copilot (CLAUDE.md §6.7) — exact Borrow-and-Earn formulas.
// Source: https://docs.strikefinance.org/perpetuals/vaults/borrow-and-earn.md (sections "How credit health works",
// "Reading the displayed health score", "When recovery finishes", debt-remainder lock, conversion price).
// There is no per-user credit-line endpoint (VERIFICATION #13): q, D, s are USER-ENTERED line values.
import { D, type Dec, dec } from "./money.js";

export interface CreditParams {
  /** Admission ratio M (per asset, /v2/credit/settings credit_admission_ratio) */
  M: Dec;
  /** Collateral reference loss X (credit_collateral_reference_loss) */
  X: Dec;
  /** Conversion discount d (credit_collateral_conversion_discount) */
  d: Dec;
  /** Vault reference loss Y (shared, config/credit.ts) */
  Y: Dec;
  /** Collateral floor F (shared) */
  F: Dec;
  /** Recovery target parameter r (shared) */
  r: Dec;
  /** Asset decimal places (asset_prec) */
  assetPrec: number;
}

const ONE = new D(1);

/** Φ(v) = (1 − v)/Y if v ≤ 1, else 1 − v. */
export function phi(v: Dec, Y: Dec): Dec {
  return v.lte(1) ? ONE.sub(v).div(Y) : ONE.sub(v);
}

/** J = (1 − c)/X + Φ(v), with c = C/D, v = V/D. */
export function jointRisk(C: Dec, V: Dec, Dt: Dec, p: Pick<CreditParams, "X" | "Y">): Dec {
  const c = C.div(Dt), v = V.div(Dt);
  return ONE.sub(c).div(p.X).add(phi(v, p.Y));
}

export interface Health {
  c: Dec;
  v: Dec;
  J: Dec;
  jointHealth: Dec;
  floorHealth: Dec;
  /** max(0, min(joint, floor)) — score points, not percentages */
  creditHealth: Dec;
  state: "ACTIVE" | "RECOVERY";
}

export function health(C: Dec, V: Dec, Dt: Dec, p: CreditParams): Health {
  if (Dt.lte(0)) throw new Error("debt must be > 0 for a health score");
  const c = C.div(Dt), v = V.div(Dt);
  const J = ONE.sub(c).div(p.X).add(phi(v, p.Y));
  const jointHealth = new D(100).mul(new D(2).sub(J));
  const floorHealth = new D(100).mul(c).div(p.F);
  const creditHealth = D.max(0, D.min(jointHealth, floorHealth));
  // Active iff J < 1 and c > F; equality starts recovery.
  const state = J.lt(1) && c.gt(p.F) ? "ACTIVE" : "RECOVERY";
  return { c, v, J, jointHealth, floorHealth, creditHealth, state };
}

/** J* = (1 − r/X)/(1 − r), F* = F/(1 − r). */
export function completionTargets(p: CreditParams): { Jstar: Dec; Fstar: Dec; jointHealthTarget: Dec; floorHealthTarget: Dec } {
  const Jstar = ONE.sub(p.r.div(p.X)).div(ONE.sub(p.r));
  const Fstar = p.F.div(ONE.sub(p.r));
  return { Jstar, Fstar, jointHealthTarget: new D(100).mul(new D(2).sub(Jstar)), floorHealthTarget: new D(100).mul(Fstar).div(p.F) };
}

/** Admission: D_after ≤ M·C_after. */
export const admissionOk = (Dafter: Dec, Cafter: Dec, p: CreditParams) => Dafter.lte(p.M.mul(Cafter));

/**
 * Recovery-boundary collateral price for given V, D and q units: solve J = 1 and c = F for P;
 * the higher price binds first as the collateral price falls.
 *   J = 1  ⇒ c = 1 − X·(1 − Φ(v))  ⇒  P_joint = D·(1 − X·(1 − Φ(v))) / q
 *   c = F  ⇒  P_floor = F·D / q
 */
export function boundaryPrice(q: Dec, V: Dec, Dt: Dec, p: CreditParams): { price: Dec; binds: "joint" | "floor"; jointPrice: Dec; floorPrice: Dec } {
  const v = V.div(Dt);
  const cJoint = ONE.sub(p.X.mul(ONE.sub(phi(v, p.Y))));
  const jointPrice = D.max(0, cJoint.mul(Dt).div(q));
  const floorPrice = p.F.mul(Dt).div(q);
  return jointPrice.gte(floorPrice) ? { price: jointPrice, binds: "joint", jointPrice, floorPrice } : { price: floorPrice, binds: "floor", jointPrice, floorPrice };
}

const meetsTargets = (C: Dec, V: Dec, Dt: Dec, p: CreditParams, t: ReturnType<typeof completionTargets>) =>
  Dt.lte(0) || (jointRisk(C, V, Dt, p).lte(t.Jstar) && C.div(Dt).gte(t.Fstar));

/** Bisection for the minimal x in [0, hi] with ok(x) (ok monotone non-decreasing in x). */
function bisectMin(ok: (x: Dec) => boolean, hi: Dec, tol: Dec): Dec {
  let lo = new D(0);
  if (ok(lo)) return lo;
  let h = hi;
  for (let i = 0; i < 400 && h.sub(lo).gt(tol); i++) {
    const mid = lo.add(h).div(2);
    if (ok(mid)) h = mid;
    else lo = mid;
  }
  return h;
}

/**
 * Minimum fixes that reach J ≤ J* AND c ≥ F* (CLAUDE.md §6.7):
 *  (a) cash repay R (reduces D; C, V unchanged), rounded UP to cents;
 *  (b) extra collateral Δq (raises C at price P), rounded UP to asset precision.
 */
export function fixAmounts(q: Dec, P: Dec, V: Dec, Dt: Dec, p: CreditParams): { repayUsd: Dec; addCollateralUnits: Dec; alreadyMeets: boolean } {
  const t = completionTargets(p);
  const C = q.mul(P);
  const alreadyMeets = meetsTargets(C, V, Dt, p, t);
  if (alreadyMeets) return { repayUsd: new D(0), addCollateralUnits: new D(0), alreadyMeets };
  const R = bisectMin((r) => meetsTargets(C, V, Dt.sub(r), p, t), Dt, new D("1e-10"));
  const repayUsd = R.toDecimalPlaces(2, D.ROUND_CEIL);
  // Upper bound for Δq: enough collateral alone to satisfy both targets with V contributing nothing positive.
  let hi = D.max(q, ONE);
  while (!meetsTargets(q.add(hi).mul(P), V, Dt, p, t) && hi.lt("1e18")) hi = hi.mul(2);
  const dq = bisectMin((x) => meetsTargets(q.add(x).mul(P), V, Dt, p, t), hi, new D("1e-12"));
  return { repayUsd, addCollateralUnits: dq.toDecimalPlaces(p.assetPrec, D.ROUND_CEIL), alreadyMeets };
}

/** Debt-remainder lock (display only): C_lock = max(D_r/((1 − d)(1 − X)), F·D_r, D_r/M); units rounded up. */
export function debtRemainderLock(Dr: Dec, P: Dec, p: CreditParams): { usd: Dec; units: Dec } {
  const usd = D.max(Dr.div(ONE.sub(p.d).mul(ONE.sub(p.X))), p.F.mul(Dr), Dr.div(p.M));
  return { usd, units: usd.div(P).toDecimalPlaces(p.assetPrec, D.ROUND_CEIL) };
}

/** Conversion price P·(1 − d). */
export const conversionPrice = (P: Dec, p: CreditParams) => P.mul(ONE.sub(p.d));

export interface GridCell { collateralChangePct: number; vaultDrawdownPct: number; health: string; J: string; state: "ACTIVE" | "RECOVERY" }

/** Heatmap: collateral price change 0 → −50% × SLP drawdown 0 → −30% (5-point steps). */
export function stressGrid(q: Dec, P: Dec, s: Dec, S: Dec, Dt: Dec, p: CreditParams): GridCell[][] {
  const rows: GridCell[][] = [];
  for (let vd = 0; vd <= 30; vd += 5) {
    const row: GridCell[] = [];
    for (let cd = 0; cd <= 50; cd += 5) {
      const C = q.mul(P).mul(ONE.sub(new D(cd).div(100)));
      const V = s.mul(S).mul(ONE.sub(new D(vd).div(100)));
      const h = health(C, V, Dt, p);
      row.push({ collateralChangePct: -cd, vaultDrawdownPct: -vd, health: h.creditHealth.toFixed(2), J: h.J.toFixed(4), state: h.state });
    }
    rows.push(row);
  }
  return rows;
}

export function paramsFrom(settings: { credit_admission_ratio: string; credit_collateral_reference_loss: string; credit_collateral_conversion_discount: string; asset_prec: number }, shared: { Y: string; F: string; r: string }): CreditParams {
  return {
    M: dec(settings.credit_admission_ratio),
    X: dec(settings.credit_collateral_reference_loss),
    d: dec(settings.credit_collateral_conversion_discount),
    Y: dec(shared.Y),
    F: dec(shared.F),
    r: dec(shared.r),
    assetPrec: settings.asset_prec,
  };
}
