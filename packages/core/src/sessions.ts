// Underlying-session state (CLAUDE.md §6.1). Time zones via luxon; no manual UTC-offset math.
import { type Holiday, type SessionEntry, US_EQUITY_HOLIDAYS, US_EQUITY_HOLIDAYS_PAST_2026 } from "@apex/config";
import { DateTime } from "luxon";

export interface Interval { open: number; close: number }
export type UnderlyingState = "open" | "closed" | "unknown";

export interface SessionState {
  underlying: UnderlyingState;
  nextOpen: number | null;
  nextClose: number | null;
}

const HOLIDAYS: ReadonlyMap<string, Holiday> = new Map(
  [...US_EQUITY_HOLIDAYS_PAST_2026, ...US_EQUITY_HOLIDAYS].map((h) => [h.date, h]),
);

function at(day: DateTime, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return day.set({ hour: h ?? 0, minute: m ?? 0, second: 0, millisecond: 0 }).toMillis();
}

/** Regular underlying sessions overlapping [fromMs, toMs]. Empty for `unknown` schedules. */
export function sessionIntervals(entry: SessionEntry, fromMs: number, toMs: number): Interval[] {
  const { schedule, tz } = entry;
  if (schedule.kind === "unknown") return [];
  const out: Interval[] = [];
  let day = DateTime.fromMillis(fromMs, { zone: tz }).startOf("day").minus({ days: 1 });
  const end = DateTime.fromMillis(toMs, { zone: tz }).startOf("day").plus({ days: 1 });
  for (; day <= end; day = day.plus({ days: 1 })) {
    const wd = day.weekday; // 1 = Mon … 7 = Sun
    if (wd > 5) continue;
    if (schedule.kind === "us_equity_regular") {
      // NYSE core session 09:30–16:00 ET; holidays/early closes from config (nyse.com).
      const hol = HOLIDAYS.get(day.toISODate() ?? "");
      if (hol?.type === "closed") continue;
      const close = hol?.type === "early_close" && hol.close ? hol.close : "16:00";
      out.push({ open: at(day, "09:30"), close: at(day, close) });
    } else {
      // CME Globex: session for trade date D runs D-1 18:00 → D 17:00 ET (Sun 18:00 → Fri 17:00 overall).
      out.push({ open: at(day.minus({ days: 1 }), "18:00"), close: at(day, "17:00") });
    }
  }
  return out.filter((i) => i.close > fromMs && i.open < toMs);
}

const LOOKAHEAD_MS = 14 * 24 * 3600_000;

/** State at `nowMs`. No entry = crypto (trades 24/7). */
export function sessionState(entry: SessionEntry | undefined, nowMs: number): SessionState {
  if (!entry) return { underlying: "open", nextOpen: null, nextClose: null };
  if (entry.schedule.kind === "unknown") return { underlying: "unknown", nextOpen: null, nextClose: null };
  const ivs = sessionIntervals(entry, nowMs - 24 * 3600_000, nowMs + LOOKAHEAD_MS);
  const current = ivs.find((i) => i.open <= nowMs && nowMs < i.close);
  if (current) {
    const next = ivs.find((i) => i.open >= current.close);
    return { underlying: "open", nextOpen: next?.open ?? null, nextClose: current.close };
  }
  const next = ivs.find((i) => i.open > nowMs);
  return { underlying: "closed", nextOpen: next?.open ?? null, nextClose: next?.close ?? null };
}
