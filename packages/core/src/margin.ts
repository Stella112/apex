// Margin math as the Strike backend computes it.
// Source: ref/strike-finance-skills/skills/strike-calculations/SKILL.md — sections "Margin Tiers",
// "Position-Derived Fields", "Margin Profiles (cross vs isolated)", "Bankruptcy and Liquidation Price".
import { D, type Dec, dec } from "./money.js";
import type { MarginTier } from "./schemas.js";

/** strike-calculations: the backend rounds half-even with 19 significant digits (govalues/decimal). */
const E = D.clone({ precision: 19, rounding: D.ROUND_HALF_EVEN });
const e = (x: Dec | string | number) => new E(x.toString());
const roundQ = (x: Dec, quotePrec: number) => x.toDecimalPlaces(quotePrec, D.ROUND_HALF_EVEN);

/** "Tier by notional": first tier with notional <= max_notional; above the last, the last tier. */
export function tierIndexByNotional(tiers: MarginTier[], notional: Dec): number {
  for (let i = 0; i < tiers.length; i++) if (notional.lte(dec(tiers[i]!.max_notional))) return i;
  return tiers.length - 1;
}

/** "Max leverage of a market = margin_tiers[0].max_leverage". */
export const marketMaxLeverage = (tiers: MarginTier[]) => tiers[0]!.max_leverage;

/** "Tier by leverage": highest index with leverage <= max_leverage[i]. */
export function tierIndexByLeverage(tiers: MarginTier[], leverage: number): number {
  if (leverage <= 0 || leverage > tiers[0]!.max_leverage) throw new Error(`invalid leverage ${leverage}`);
  let idx = 0;
  for (let i = 0; i < tiers.length; i++) if (leverage <= tiers[i]!.max_leverage) idx = i;
  return idx;
}

export interface Derived { notional: Dec; upnl: Dec; im: Dec; mm: Dec; tier: number }

/** "Position-Derived Fields": notional, uPnL, IM, MM (tier lookup on the UNROUNDED notional). */
export function derive(size: Dec, entry: Dec, leverage: number, mark: Dec, tiers: MarginTier[], quotePrec: number): Derived {
  if (size.isZero()) return { notional: new D(0), upnl: new D(0), im: new D(0), mm: new D(0), tier: 0 };
  const raw = e(mark).mul(e(size).abs());
  const tier = tierIndexByNotional(tiers, raw);
  const t = tiers[tier]!;
  return {
    notional: roundQ(new D(raw), quotePrec),
    upnl: roundQ(new D(e(mark).sub(e(entry)).mul(e(size))), quotePrec),
    im: leverage > 0 ? roundQ(new D(raw.div(leverage)), quotePrec) : new D(0),
    mm: roundQ(new D(raw.mul(e(t.maintenance_margin_rate)).sub(e(t.maintenance_amount))), quotePrec),
    tier,
  };
}

export interface Profile { W: Dec; upnl: Dec; mm: Dec; count: number }

/**
 * "Bankruptcy and Liquidation Price":
 *   BP = entry − (W + TU) / size
 *   LP = (entry − (W + TU − TM + MA) / size) / (1 − dir·MMR)
 * TU/TM = profile minus this position, only for a cross profile with count > 1. Unrounded; ≤ 0 → 0 (none).
 */
export function liqAndBankruptcy(size: Dec, entry: Dec, d: Derived, tiers: MarginTier[], profile: Profile): { bp: Dec; lp: Dec } {
  if (size.isZero() || profile.count === 0) return { bp: new D(0), lp: new D(0) };
  const others = profile.count > 1;
  const TU = others ? e(profile.upnl).sub(e(d.upnl)) : new E(0);
  const TM = others ? e(profile.mm).sub(e(d.mm)) : new E(0);
  const t = tiers[d.tier]!;
  const dir = size.isPos() ? 1 : -1;
  const bp = e(entry).sub(e(profile.W).add(TU).div(e(size)));
  const lp = e(entry)
    .sub(e(profile.W).add(TU).sub(TM).add(e(t.maintenance_amount)).div(e(size)))
    .div(new E(1).sub(e(t.maintenance_margin_rate).mul(dir)));
  return { bp: bp.isPos() ? new D(bp) : new D(0), lp: lp.isPos() ? new D(lp) : new D(0) };
}

export interface PositionInput {
  symbol: string;
  size: string;
  entry_price: string;
  leverage: number;
  margin_mode: "cross" | "isolated";
  iso_balance: string;
}

export interface MarketMath { tiers: MarginTier[]; quotePrec: number; mark: string }

/** Liquidation/bankruptcy for every position of an account (the skill's "Full Example"). */
export function accountLiquidations(positions: PositionInput[], markets: Record<string, MarketMath>, walletBalance: Dec) {
  const rows = positions
    .filter((p) => !dec(p.size).isZero())
    .map((p) => {
      const m = markets[p.symbol];
      if (!m) throw new Error(`no market data for ${p.symbol}`);
      return { p, m, d: derive(dec(p.size), dec(p.entry_price), p.leverage, dec(m.mark), m.tiers, m.quotePrec) };
    });
  const isoSum = rows.filter((r) => r.p.margin_mode === "isolated").reduce((s, r) => s.add(dec(r.p.iso_balance)), new D(0));
  const cross = rows.filter((r) => r.p.margin_mode === "cross");
  const crossProfile: Profile = {
    W: walletBalance.sub(isoSum),
    upnl: cross.reduce((s, r) => s.add(r.d.upnl), new D(0)),
    mm: cross.reduce((s, r) => s.add(r.d.mm), new D(0)),
    count: cross.length,
  };
  return rows.map(({ p, m, d }) => {
    const profile: Profile = p.margin_mode === "isolated" ? { W: dec(p.iso_balance), upnl: d.upnl, mm: d.mm, count: 1 } : crossProfile;
    return { symbol: p.symbol, derived: d, ...liqAndBankruptcy(dec(p.size), dec(p.entry_price), d, m.tiers, profile), mark: m.mark };
  });
}

export interface LiqCheck {
  symbol: string;
  computed: string;
  served: string;
  diffPct: string | null;
  match: boolean;
}

/**
 * CLAUDE.md §6.5 validation: Apex's liquidation price must be within 1% of Strike's `liquidation_price`.
 * Both "0" (no liquidation price) counts as a match.
 */
export function compareLiquidations(computed: Array<{ symbol: string; lp: Dec }>, served: Array<{ symbol: string; liquidation_price: string }>, tolerancePct = "1"): LiqCheck[] {
  return computed.map((c) => {
    const s = served.find((x) => x.symbol === c.symbol);
    const servedLp = s ? dec(s.liquidation_price) : null;
    if (!servedLp) return { symbol: c.symbol, computed: c.lp.toString(), served: "missing", diffPct: null, match: false };
    if (servedLp.isZero() || c.lp.isZero()) {
      return { symbol: c.symbol, computed: c.lp.toString(), served: servedLp.toString(), diffPct: null, match: servedLp.isZero() && c.lp.isZero() };
    }
    const diff = c.lp.sub(servedLp).abs().div(servedLp).mul(100);
    return { symbol: c.symbol, computed: c.lp.toSignificantDigits(12).toString(), served: servedLp.toSignificantDigits(12).toString(), diffPct: diff.toSignificantDigits(3).toString(), match: diff.lte(dec(tolerancePct)) };
  });
}
