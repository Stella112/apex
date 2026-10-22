// Fair-value band for equity and index perps while the underlying is closed (CLAUDE.md §6.6, P1).
// Regress weekday 1h returns of the market on its reference index perp; implied price =
// last mark at underlying close × (1 + β × reference-perp return since close);
// band = ± 2 × residual σ × √hours since close. Labeled ESTIMATE. R² < 0.2 → no reliable band.
// Statistics use JS numbers (not money); prices are reported as decimal strings.
import type { SessionEntry } from "@apex/config";
import { dec } from "./money.js";
import type { Kline } from "./schemas.js";
import { priceAtOrBefore } from "./shield.js";
import { sessionIntervals } from "./sessions.js";

const HOUR = 3600_000;

/** Reference index perp (decided: equities → NAS100; NAS100 ↔ SP500). */
export function referenceFor(symbol: string, cls: string): string | null {
  if (symbol === "NAS100-USD") return "SP500-USD";
  if (symbol === "SP500-USD") return "NAS100-USD";
  return cls === "equity" ? "NAS100-USD" : null;
}

export interface Regression { beta: number; alpha: number; r2: number; residSigma: number; n: number }

/** OLS of y on x. */
export function ols(x: number[], y: number[]): Regression | null {
  const n = Math.min(x.length, y.length);
  if (n < 30) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i]! - mx) ** 2;
    sxy += (x[i]! - mx) * (y[i]! - my);
    syy += (y[i]! - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const beta = sxy / sxx, alpha = my - beta * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i]! - alpha - beta * x[i]!) ** 2;
  return { beta, alpha, r2: 1 - sse / syy, residSigma: Math.sqrt(sse / (n - 2)), n };
}

/** Aligned weekday (America/New_York) 1h simple returns of `a` and `b` by candle open time. */
export function alignedWeekdayReturns(a: Kline[], b: Kline[]): { x: number[]; y: number[] } {
  const bm = new Map(b.map((k) => [k.openTime, k]));
  const x: number[] = [], y: number[] = [];
  for (let i = 1; i < a.length; i++) {
    const cur = a[i]!, prev = a[i - 1]!;
    if (cur.openTime - prev.openTime !== HOUR) continue;
    const wd = new Date(cur.openTime).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const bc = bm.get(cur.openTime), bp = bm.get(prev.openTime);
    if (!bc || !bp) continue;
    const ra = Number(cur.close) / Number(prev.close) - 1, rb = Number(bc.close) / Number(bp.close) - 1;
    if (Number.isFinite(ra) && Number.isFinite(rb)) {
      y.push(ra);
      x.push(rb);
    }
  }
  return { x, y };
}

export interface FairValue {
  symbol: string;
  reference: string | null;
  status: "OK" | "UNDERLYING_OPEN" | "NO_RELIABLE_BAND" | "INSUFFICIENT_DATA" | "NO_SESSION";
  label: "ESTIMATE";
  beta: string | null;
  r2: string | null;
  samples: number;
  lastCloseAt: string | null;
  markAtClose: string | null;
  referenceReturnSinceClosePct: string | null;
  hoursSinceClose: string | null;
  implied: string | null;
  bandLow: string | null;
  bandHigh: string | null;
  bandHalfWidthPct: string | null;
  mark: string;
  deviationPct: string | null;
  note: string;
}

export function fairValue(symbol: string, cls: string, entry: SessionEntry | undefined, mark: string, refMark: string | null, k: Kline[], refK: Kline[], now: number): FairValue {
  const reference = referenceFor(symbol, cls);
  const base: FairValue = {
    symbol, reference, status: "INSUFFICIENT_DATA", label: "ESTIMATE", beta: null, r2: null, samples: 0, lastCloseAt: null, markAtClose: null,
    referenceReturnSinceClosePct: null, hoursSinceClose: null, implied: null, bandLow: null, bandHigh: null, bandHalfWidthPct: null, mark, deviationPct: null, note: "",
  };
  if (!reference || !entry || entry.schedule.kind === "unknown") return { ...base, status: "NO_SESSION", note: "no cited underlying session or no reference index" };
  const { x, y } = alignedWeekdayReturns(k, refK);
  const reg = ols(x, y);
  if (!reg) return { ...base, note: "fewer than 30 aligned weekday hours" };
  const out = { ...base, beta: reg.beta.toFixed(3), r2: reg.r2.toFixed(3), samples: reg.n };
  const ivs = sessionIntervals(entry, now - 14 * 24 * HOUR, now + HOUR);
  const open = ivs.find((i) => i.open <= now && now < i.close);
  if (open) return { ...out, status: "UNDERLYING_OPEN", note: "underlying session open: the perp tracks the live cash market" };
  const last = [...ivs].reverse().find((i) => i.close <= now);
  if (!last) return { ...out, note: "no recent session close in range" };
  const markAtClose = priceAtOrBefore(k, last.close), refAtClose = priceAtOrBefore(refK, last.close);
  const hours = (now - last.close) / HOUR;
  if (!markAtClose || !refAtClose || !refMark) return { ...out, lastCloseAt: new Date(last.close).toISOString(), note: "no mark at the last close" };
  const refRet = Number(refMark) / Number(refAtClose) - 1;
  const common = { lastCloseAt: new Date(last.close).toISOString(), markAtClose, referenceReturnSinceClosePct: (refRet * 100).toFixed(3), hoursSinceClose: hours.toFixed(1) };
  if (reg.r2 < 0.2) return { ...out, ...common, status: "NO_RELIABLE_BAND", note: `R² ${reg.r2.toFixed(3)} < 0.2: no reliable band` };
  const implied = dec(markAtClose).mul(dec((1 + reg.beta * refRet).toString()));
  const half = 2 * reg.residSigma * Math.sqrt(Math.max(hours, 1));
  const lo = implied.mul(dec((1 - half).toString())), hi = implied.mul(dec((1 + half).toString()));
  return {
    ...out, ...common, status: "OK",
    implied: implied.toSignificantDigits(10).toString(),
    bandLow: lo.toSignificantDigits(10).toString(),
    bandHigh: hi.toSignificantDigits(10).toString(),
    bandHalfWidthPct: (half * 100).toFixed(3),
    deviationPct: dec(mark).div(implied).sub(1).mul(100).toFixed(3),
    note: `β ${reg.beta.toFixed(3)} on ${reference}, R² ${reg.r2.toFixed(3)}, n=${reg.n}; band ±2·σ_resid·√h`,
  };
}
