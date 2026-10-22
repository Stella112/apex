// Weekend Shield (CLAUDE.md §6.6): closed-window gap risk, flags, protection proposals.
// Statistics (returns, σ, probabilities) use JS numbers — they are not money. Prices/sizes stay decimal.
import { GAP_BANDS, type SessionEntry, THIN_BOOK_USD } from "@apex/config";
import { D, type Dec, dec, floorToStep, roundToTick } from "./money.js";
import type { Kline } from "./schemas.js";
import { type Interval, sessionIntervals, sessionState } from "./sessions.js";
import type { Depth, MarginTier } from "./schemas.js";
import { derive } from "./margin.js";

const HOUR = 3600_000;

export type GapMethod = "EMPIRICAL" | "MODELED" | "N/A";
export type Band = "LOW" | "MEDIUM" | "HIGH" | "N/A";

export interface ClosedWindow { close: number; open: number; hours: number }
export interface WindowReturn extends ClosedWindow { ret: number; from: string; to: string }

/** Gaps between consecutive regular sessions overlapping [from, to]. */
export function closedWindows(entry: SessionEntry, fromMs: number, toMs: number): ClosedWindow[] {
  const ivs: Interval[] = sessionIntervals(entry, fromMs, toMs);
  const out: ClosedWindow[] = [];
  for (let i = 0; i + 1 < ivs.length; i++) {
    const a = ivs[i]!, b = ivs[i + 1]!;
    if (b.open > a.close) out.push({ close: a.close, open: b.open, hours: (b.open - a.close) / HOUR });
  }
  return out;
}

/** Close of the last 1h candle ending at or before t (price "at" the underlying close). */
export function priceAtOrBefore(k: Kline[], t: number): string | null {
  let best: Kline | null = null;
  for (const c of k) if (c.closeTime + 1 <= t) best = c;
  return best ? best.close : null;
}

/** Close of the first 1h candle ending at or after t (includes the reaction to the open). */
export function priceAtOrAfter(k: Kline[], t: number): string | null {
  for (const c of k) if (c.closeTime + 1 >= t) return c.close;
  return null;
}

/** Mark return across each closed window covered by the klines (CLAUDE.md §6.6). */
export function windowReturns(k: Kline[], entry: SessionEntry): WindowReturn[] {
  if (k.length < 2) return [];
  const first = k[0]!.openTime, last = k[k.length - 1]!.closeTime + 1;
  return closedWindows(entry, first, last)
    .filter((w) => w.close >= first + HOUR && w.open + HOUR <= last)
    .flatMap((w) => {
      const a = priceAtOrBefore(k, w.close), b = priceAtOrAfter(k, w.open);
      if (!a || !b || dec(a).isZero()) return [];
      return [{ ...w, from: a, to: b, ret: dec(b).div(dec(a)).sub(1).toNumber() }];
    });
}

/** σ of 1h log-returns on weekdays (America/New_York), for the MODELED method. */
export function weekdayHourlySigma(k: Kline[]): number | null {
  const rs: number[] = [];
  for (let i = 1; i < k.length; i++) {
    const wd = new Date(k[i]!.openTime).getUTCDay(); // UTC weekday is close enough for selecting Mon–Fri hours
    if (wd === 0 || wd === 6) continue;
    const a = Number(k[i - 1]!.close), b = Number(k[i]!.close);
    if (a > 0 && b > 0) rs.push(Math.log(b / a));
  }
  if (rs.length < 24) return null;
  const mean = rs.reduce((s, x) => s + x, 0) / rs.length;
  return Math.sqrt(rs.reduce((s, x) => s + (x - mean) ** 2, 0) / (rs.length - 1));
}

/** Standard normal CDF via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Longest regular closed window of a US-style week (Fri 16:00 → Mon 09:30 ET) — conservative assumption for unknown sessions. */
export const UNKNOWN_SESSION_WINDOW_HOURS = 65.5;

export interface GapDistribution {
  method: GapMethod;
  samples: number;
  /** returns of each historical closed window (EMPIRICAL) */
  returns: number[];
  sigmaHourly: number | null;
  /** hours of the next (or current) closed window */
  windowHours: number | null;
  note: string;
}

/** Hours of the closed window that is current (remaining) or next. */
export function upcomingClosedHours(entry: SessionEntry, now: number): number | null {
  const st = sessionState(entry, now);
  if (st.underlying === "unknown") return null;
  if (st.underlying === "closed") return st.nextOpen ? (st.nextOpen - now) / HOUR : null;
  const win = closedWindows(entry, now, now + 14 * 24 * HOUR).find((w) => w.close >= now);
  return win ? win.hours : null;
}

export function gapDistribution(entry: SessionEntry | undefined, klines: Kline[], now: number): GapDistribution {
  if (!entry) return { method: "N/A", samples: 0, returns: [], sigmaHourly: null, windowHours: null, note: "crypto: underlying trades 24/7, no closed-session gap" };
  const sigma = weekdayHourlySigma(klines);
  if (entry.schedule.kind === "unknown") {
    return {
      method: "MODELED", samples: 0, returns: [], sigmaHourly: sigma, windowHours: UNKNOWN_SESSION_WINDOW_HOURS,
      note: `underlying session unknown: modeled as a ${UNKNOWN_SESSION_WINDOW_HOURS}h closed window (conservative)`,
    };
  }
  const rets = windowReturns(klines, entry);
  const hours = upcomingClosedHours(entry, now);
  if (rets.length >= 8) {
    return { method: "EMPIRICAL", samples: rets.length, returns: rets.map((r) => r.ret), sigmaHourly: sigma, windowHours: hours, note: `${rets.length} historical close→open windows from 1h mark klines` };
  }
  return { method: "MODELED", samples: rets.length, returns: [], sigmaHourly: sigma, windowHours: hours, note: `only ${rets.length} closed windows in history (<8): σ_1h × √hours` };
}

/** Probability an adverse closed-window move is ≥ d (fraction, e.g. 0.15) for a long or short. */
export function pGap(dist: GapDistribution, side: "long" | "short", d: number): number | null {
  if (dist.method === "N/A") return null;
  if (dist.method === "EMPIRICAL") {
    const hits = dist.returns.filter((r) => (side === "long" ? r <= -d : r >= d)).length;
    return hits / dist.returns.length;
  }
  if (dist.sigmaHourly === null || dist.windowHours === null) return null;
  const s = dist.sigmaHourly * Math.sqrt(Math.max(dist.windowHours, 0));
  if (s === 0) return 0;
  // log-normal tail: long loses d when ln(P1/P0) ≤ ln(1 − d); short when ≥ ln(1 + d).
  return side === "long" ? (d >= 1 ? 0 : normCdf(Math.log(1 - d) / s)) : 1 - normCdf(Math.log(1 + d) / s);
}

export function band(p: number | null): Band {
  if (p === null) return "N/A";
  if (p < Number(GAP_BANDS.lowBelow)) return "LOW";
  if (p > Number(GAP_BANDS.highAbove)) return "HIGH";
  return "MEDIUM";
}

/** Smallest liquidation distance d with p_gap(d) < LOW threshold (search in 0.25% steps up to 95%). */
export function distanceForLowBand(dist: GapDistribution, side: "long" | "short"): number | null {
  for (let bp = 25; bp <= 9500; bp += 25) {
    const p = pGap(dist, side, bp / 10000);
    if (p !== null && p < Number(GAP_BANDS.lowBelow)) return bp / 10000;
  }
  return null;
}

export type Flag = "STALE_MARK" | "THIN_BOOK" | "UNDERLYING_UNKNOWN";

/** STALE_MARK: last `n` 1h mark candles flat (O=H=L=C) at one price (CLAUDE.md §4.9; mark klines carry no volume, VERIFICATION #9). */
export function isStaleMark(k: Kline[], n = 3): boolean {
  if (k.length < n) return false;
  const tail = k.slice(-n);
  const p = tail[0]!.close;
  return tail.every((c) => c.open === p && c.high === p && c.low === p && c.close === p);
}

/** Book notional within ±1% of mark on the thinner side. */
export function bookDepthUsd(depth: Depth, mark: Dec): { bidUsd: Dec; askUsd: Dec } {
  const lo = mark.mul(0.99), hi = mark.mul(1.01);
  const sum = (lv: [string, string][], ok: (p: Dec) => boolean) => lv.reduce((s, [p, q]) => (ok(dec(p)) ? s.add(dec(p).mul(dec(q))) : s), new D(0));
  return { bidUsd: sum(depth.bids, (p) => p.gte(lo)), askUsd: sum(depth.asks, (p) => p.lte(hi)) };
}

export function flagsFor(entry: SessionEntry | undefined, isCrypto: boolean, k: Kline[], depth: Depth | null, mark: Dec | null): Flag[] {
  const f: Flag[] = [];
  if (isStaleMark(k)) f.push("STALE_MARK");
  if (depth && mark) {
    const { bidUsd, askUsd } = bookDepthUsd(depth, mark);
    if (D.min(bidUsd, askUsd).lt(dec(THIN_BOOK_USD))) f.push("THIN_BOOK");
  }
  if (!isCrypto && (!entry || entry.schedule.kind === "unknown")) f.push("UNDERLYING_UNKNOWN");
  return f;
}

// ── protection math ──────────────────────────────────────────────────────────

/**
 * Protective stop price (decided rule, VERIFICATION #36): sits `minDistPct` beyond the liquidation
 * price toward mark — or halfway between liquidation and mark when closer — rounded to tick away
 * from mark so it never triggers immediately.
 */
export function protectiveStopPrice(side: "long" | "short", mark: Dec, liq: Dec, minDistPct: Dec, tick: Dec): Dec | null {
  if (liq.isZero()) return null;
  const k = minDistPct.div(100);
  if (side === "long") {
    const half = liq.add(mark.sub(liq).div(2));
    const p = D.min(liq.mul(new D(1).add(k)), half);
    const r = roundToTick(p, tick, "down");
    return r.lt(mark) && r.gt(liq) ? r : null;
  }
  const half = liq.sub(liq.sub(mark).div(2));
  const p = D.max(liq.mul(new D(1).sub(k)), half);
  const r = roundToTick(p, tick, "up");
  return r.gt(mark) && r.lt(liq) ? r : null;
}

/**
 * isoMargin amount that moves an isolated position's LP to `targetLp`.
 * Inverts strike-calculations LP = (entry − (W + MA)/size) / (1 − dir·MMR) for W; rounded up to cents.
 */
export function isoMarginAddFor(size: Dec, entry: Dec, mark: Dec, leverage: number, isoBalance: Dec, targetLp: Dec, tiers: MarginTier[], quotePrec: number): Dec {
  const d = derive(size, entry, leverage, mark, tiers, quotePrec);
  const t = tiers[d.tier]!;
  const dir = size.isPos() ? 1 : -1;
  const W = entry.sub(targetLp.mul(new D(1).sub(dec(t.maintenance_margin_rate).mul(dir)))).mul(size).sub(dec(t.maintenance_amount));
  return D.max(W.sub(isoBalance), 0).toDecimalPlaces(2, D.ROUND_CEIL);
}

export { floorToStep };
