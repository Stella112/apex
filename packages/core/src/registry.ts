// Market registry (CLAUDE.md §6.1): merge /v2/exchangeInfo + /v2/marketStats by symbol,
// classify, attach exchange filters and underlying-session state.
// Classification rule (BLOCKERS B1, decided by Maris 2026-10-22): a cited config/sessions.ts entry
// overrides the API category; disagreement is surfaced as a CATEGORY_MISMATCH note.
import { type MarketClass, type SessionEntry, sessionFor } from "@apex/config";
import type { StrikeClient } from "./http.js";
import { getExchangeInfo, getMarketStats } from "./market.js";
import type { ExchangeInfo, ExchangeSymbol, MarketStatsEntry } from "./schemas.js";
import { type SessionState, sessionState } from "./sessions.js";

export type RegistryClass = MarketClass | "unknown";

export interface ExchangeFilters {
  tickSize: string;
  minPrice: string;
  maxPrice: string;
  /** LOT_SIZE (limit orders) */
  stepSize: string;
  minQty: string;
  maxQty: string;
  /** MARKET_LOT_SIZE (market orders) */
  marketStepSize: string;
  marketMinQty: string;
  marketMaxQty: string;
  /** MIN_NOTIONAL.notional */
  minNotional: string;
}

export interface MarketRecord {
  symbol: string;
  class: RegistryClass;
  classSource: "session_map" | "api";
  apiCategory: string;
  apiSubCategory: string;
  notes: string[];
  /** marketStats.status: ACTIVE | PRE_TRADING | BREAK | CLOSED */
  perpStatus: string;
  /** exchangeInfo status, lowercase */
  exchangeStatus: string;
  /** null when any documented filter is missing → orders are blocked (fail closed). */
  filters: ExchangeFilters | null;
  stats: {
    lastPrice: string;
    markPrice: string;
    indexPrice: string;
    /** Hourly rate (VERIFICATION.md Phase 0 #6). */
    fundingRateHourly: string;
    nextFundingTime: number;
    openInterest: string;
    volume24h: string;
    priceChangePct24h: string;
  };
  session: SessionEntry | undefined;
  sessionState: SessionState;
  sessionSource: string;
  /** min(fetchedAt) of the merged responses */
  fetchedAt: number;
}

export interface RegistrySnapshot {
  markets: MarketRecord[];
  onlyInExchangeInfo: string[];
  onlyInMarketStats: string[];
  fetchedAt: number;
}

function apiClass(m: MarketStatsEntry): RegistryClass {
  if (m.category === "Crypto") return "crypto";
  if (m.category === "TradFi") {
    switch (m.subCategory) {
      case "Equity": return "equity";
      case "Index": return "index";
      case "Commodity": return "commodity";
      case "FX": return "fx";
    }
  }
  return "unknown";
}

export function extractFilters(s: ExchangeSymbol): ExchangeFilters | null {
  const f = (type: string) => s.filters.find((x) => x.filterType === type) as Record<string, unknown> | undefined;
  const price = f("PRICE_FILTER"), lot = f("LOT_SIZE"), mlot = f("MARKET_LOT_SIZE"), notional = f("MIN_NOTIONAL");
  const str = (o: Record<string, unknown> | undefined, k: string) => (o && typeof o[k] === "string" ? (o[k] as string) : undefined);
  const out = {
    tickSize: str(price, "tickSize"), minPrice: str(price, "minPrice"), maxPrice: str(price, "maxPrice"),
    stepSize: str(lot, "stepSize"), minQty: str(lot, "minQty"), maxQty: str(lot, "maxQty"),
    marketStepSize: str(mlot, "stepSize"), marketMinQty: str(mlot, "minQty"), marketMaxQty: str(mlot, "maxQty"),
    minNotional: str(notional, "notional"),
  };
  return Object.values(out).every((v) => v !== undefined) ? (out as ExchangeFilters) : null;
}

export function mergeMarkets(
  info: ExchangeInfo,
  stats: MarketStatsEntry[],
  nowMs: number,
  fetchedAt: number,
): RegistrySnapshot {
  const bySymbol = new Map(info.symbols.map((s) => [s.symbol, s]));
  const statSymbols = new Set(stats.map((m) => m.symbol));
  const markets: MarketRecord[] = [];
  for (const m of stats) {
    const ex = bySymbol.get(m.symbol);
    if (!ex) continue;
    const entry = sessionFor(m.symbol);
    const fromApi = apiClass(m);
    const notes: string[] = [];
    let cls: RegistryClass = fromApi;
    let classSource: MarketRecord["classSource"] = "api";
    if (entry) {
      cls = entry.class;
      classSource = "session_map";
      if (fromApi !== entry.class) {
        notes.push(`CATEGORY_MISMATCH: API says ${m.category}/${m.subCategory || '""'}; session map says ${entry.class} (${entry.source})`);
      }
    } else if (fromApi !== "crypto") {
      notes.push(`NO_SESSION_ENTRY: non-crypto market without a cited session entry; underlying treated as unknown`);
    }
    if (entry?.schedule.kind === "unknown" || (!entry && fromApi !== "crypto")) notes.push("UNDERLYING_UNKNOWN");
    if (entry?.assumed) notes.push(`SESSION_ASSUMED: ${entry.assumed}`);
    const filters = extractFilters(ex);
    if (!filters) notes.push("FILTERS_MISSING: exchange filters incomplete; orders blocked");

    // A non-crypto market with no entry gets an `unknown` session (conservative, §6.1).
    const state: SessionState = !entry && fromApi !== "crypto"
      ? { underlying: "unknown", nextOpen: null, nextClose: null }
      : sessionState(entry, nowMs);

    markets.push({
      symbol: m.symbol,
      class: cls,
      classSource,
      apiCategory: m.category,
      apiSubCategory: m.subCategory,
      notes,
      perpStatus: m.status,
      exchangeStatus: ex.status,
      filters,
      stats: {
        lastPrice: m.marketStats.lastPrice,
        markPrice: m.marketStats.markPrice,
        indexPrice: m.marketStats.indexPrice,
        fundingRateHourly: m.marketStats.fundingRate,
        nextFundingTime: m.marketStats.nextFundingRate,
        openInterest: m.marketStats.openInterest,
        volume24h: m.marketStats.volume24h,
        priceChangePct24h: m.marketStats.priceChangePercentage24h,
      },
      session: entry,
      sessionState: state,
      sessionSource: entry ? entry.source : cls === "crypto" ? "crypto: trades 24/7" : "none",
      fetchedAt,
    });
  }
  markets.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    markets,
    onlyInExchangeInfo: info.symbols.map((s) => s.symbol).filter((s) => !statSymbols.has(s)),
    onlyInMarketStats: stats.map((m) => m.symbol).filter((s) => !bySymbol.has(s)),
    fetchedAt,
  };
}

/** Loads and refreshes the registry (default every 60 s, CLAUDE.md §6.1). */
export class MarketRegistry {
  private snapshot: RegistrySnapshot | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  lastError: unknown;

  constructor(private readonly client: StrikeClient, private readonly now: () => number = Date.now) {}

  async load(): Promise<RegistrySnapshot> {
    const [info, stats] = await Promise.all([getExchangeInfo(this.client), getMarketStats(this.client)]);
    this.snapshot = mergeMarkets(info.data, stats.data.data, this.now(), Math.min(info.fetchedAt, stats.fetchedAt));
    return this.snapshot;
  }

  start(intervalMs = 60_000): void {
    this.stop();
    this.timer = setInterval(() => {
      this.load().then(() => { this.lastError = undefined; }, (e: unknown) => { this.lastError = e; });
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  get current(): RegistrySnapshot | undefined {
    return this.snapshot;
  }

  get(symbol: string): MarketRecord | undefined {
    return this.snapshot?.markets.find((m) => m.symbol === symbol);
  }
}
