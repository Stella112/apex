// Underlying-session map (CLAUDE.md §6.1). One explicit entry per non-crypto symbol.
// Per BLOCKERS B1 (Maris, 2026-10-22): an entry here overrides the API `category` for
// classification; the registry adds a CATEGORY_MISMATCH note when they disagree.

export type MarketClass = "crypto" | "equity" | "index" | "commodity" | "fx";

export type Schedule =
  // NYSE/Nasdaq core session 09:30–16:00 America/New_York, Mon–Fri, minus US_EQUITY_HOLIDAYS.
  | { kind: "us_equity_regular" }
  // CME Globex: Sun 18:00 → Fri 17:00 America/New_York, daily 17:00–18:00 break.
  | { kind: "cme_globex" }
  // No cited schedule: underlying session is unknown and scored as closed (conservative).
  | { kind: "unknown" };

export interface SessionEntry {
  symbol: string;
  class: Exclude<MarketClass, "crypto">;
  venue: string;
  tz: string;
  schedule: Schedule;
  source: string;
  /** Set when the mapping is an assumption still to be verified. */
  assumed?: string;
}

const NYSE_SRC = "https://www.nyse.com/markets/hours-calendars (fetched 2026-10-22; Nasdaq assumed to share the NYSE holiday calendar)";
const CME_SRC = "CLAUDE.md §6.1 (CME Globex hours)";

function usEquity(symbol: string, venue: "Nasdaq" | "NYSE"): SessionEntry {
  return { symbol, class: "equity", venue, tz: "America/New_York", schedule: { kind: "us_equity_regular" }, source: NYSE_SRC };
}

function unknownEquity(symbol: string): SessionEntry {
  return {
    symbol, class: "equity", venue: "unknown", tz: "UTC", schedule: { kind: "unknown" },
    source: "CLAUDE.md §4.3 lists this market as an equity; §6.1: no cited underlying venue, session unknown",
  };
}

export const SESSIONS: readonly SessionEntry[] = [
  usEquity("TSLA-USD", "Nasdaq"),
  usEquity("NVDA-USD", "Nasdaq"),
  usEquity("GOOGL-USD", "Nasdaq"),
  usEquity("MU-USD", "Nasdaq"),
  usEquity("SNDK-USD", "Nasdaq"),
  usEquity("AAOI-USD", "Nasdaq"),
  usEquity("COIN-USD", "Nasdaq"),
  usEquity("CRCL-USD", "NYSE"),
  {
    symbol: "SP500-USD", class: "index", venue: "US cash session", tz: "America/New_York",
    schedule: { kind: "us_equity_regular" }, source: NYSE_SRC, assumed: "assumed — verify the reference feed",
  },
  {
    symbol: "NAS100-USD", class: "index", venue: "US cash session", tz: "America/New_York",
    schedule: { kind: "us_equity_regular" }, source: NYSE_SRC, assumed: "assumed — verify the reference feed",
  },
  ...["WTI-USD", "XAU-USD", "XAG-USD"].map((symbol): SessionEntry => ({
    symbol, class: "commodity", venue: "CME Globex", tz: "America/New_York",
    schedule: { kind: "cme_globex" }, source: CME_SRC, assumed: "assumed — verify (CME holidays not modeled)",
  })),
  ...["SKHYNIX-USD", "CXMT-USD", "UNITREE-USD", "MINIMAX-USD", "ZHIPU-USD", "SPCX-USD", "DRAM-USD"].map(unknownEquity),
];

export interface Holiday {
  date: string; // YYYY-MM-DD in America/New_York
  type: "closed" | "early_close";
  /** Local close time for early closes. */
  close?: string;
  name: string;
}

// Source: https://www.nyse.com/markets/hours-calendars (holiday table + early-close footnotes, fetched 2026-10-22).
export const US_EQUITY_HOLIDAYS: readonly Holiday[] = [
  { date: "2026-11-26", type: "closed", name: "Thanksgiving Day" },
  { date: "2026-11-27", type: "early_close", close: "13:00", name: "Day after Thanksgiving" },
  { date: "2026-12-24", type: "early_close", close: "13:00", name: "Christmas Eve" },
  { date: "2026-12-25", type: "closed", name: "Christmas Day" },
  { date: "2027-01-01", type: "closed", name: "New Year's Day" },
  { date: "2027-01-18", type: "closed", name: "Martin Luther King, Jr. Day" },
  { date: "2027-02-15", type: "closed", name: "Washington's Birthday" },
  { date: "2027-03-26", type: "closed", name: "Good Friday" },
  { date: "2027-05-31", type: "closed", name: "Memorial Day" },
  { date: "2027-06-18", type: "closed", name: "Juneteenth (observed)" },
  { date: "2027-07-05", type: "closed", name: "Independence Day (observed)" },
  { date: "2027-09-06", type: "closed", name: "Labor Day" },
  { date: "2027-11-25", type: "closed", name: "Thanksgiving Day" },
  { date: "2027-11-26", type: "early_close", close: "13:00", name: "Day after Thanksgiving" },
  { date: "2027-12-24", type: "closed", name: "Christmas Day (observed)" },
];

// Past 2026 holidays, needed when computing historical closed windows from klines (Phase 4).
// Same source table, 2026 column.
export const US_EQUITY_HOLIDAYS_PAST_2026: readonly Holiday[] = [
  { date: "2026-01-01", type: "closed", name: "New Year's Day" },
  { date: "2026-01-19", type: "closed", name: "Martin Luther King, Jr. Day" },
  { date: "2026-02-16", type: "closed", name: "Washington's Birthday" },
  { date: "2026-04-03", type: "closed", name: "Good Friday" },
  { date: "2026-05-25", type: "closed", name: "Memorial Day" },
  { date: "2026-06-19", type: "closed", name: "Juneteenth" },
  { date: "2026-07-03", type: "closed", name: "Independence Day (observed)" },
  { date: "2026-09-07", type: "closed", name: "Labor Day" },
];

export function sessionFor(symbol: string): SessionEntry | undefined {
  return SESSIONS.find((s) => s.symbol === symbol);
}
