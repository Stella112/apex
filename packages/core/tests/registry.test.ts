import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { extractFilters, mergeMarkets } from "../src/registry.js";
import {
  Account, CollateralAssets, CreditSettings, Depth, ExchangeInfo, FeeTiers, HistoryOrders, Klines, MarkPrices,
  MarketStats, OpenOrders, Positions, Vault, VaultList,
} from "../src/schemas.js";
import { fixture } from "./fixtures.js";

const info = ExchangeInfo.parse(fixture("exchangeInfo"));
const stats = MarketStats.parse(fixture("marketStats")).data;
const now = DateTime.fromISO("2026-10-22T15:00", { zone: "America/New_York" }).toMillis();
const snap = mergeMarkets(info, stats, now, now);
const get = (s: string) => snap.markets.find((m) => m.symbol === s)!;

describe("live fixtures parse with the schemas", () => {
  it.each([
    ["exchangeInfo", ExchangeInfo], ["marketStats", MarketStats], ["markPrice", MarkPrices],
    ["depth_BTC-USD", Depth], ["depth_NVDA-USD", Depth], ["klines_NVDA-USD_1h_mark", Klines],
    ["fee-tiers", FeeTiers], ["credit_settings", CreditSettings], ["credit_collateral-assets", CollateralAssets],
    ["vaults_protocol", VaultList], ["vault_slp", Vault], ["account_vault_slp", Account],
    ["positions_vault_slp", Positions], ["openOrders_vault_slp_NVDA", OpenOrders], ["history_order_vault_slp_NVDA", HistoryOrders],
  ] as const)("%s", (name, schema) => {
    expect(schema.safeParse(fixture(name)).success).toBe(true);
  });
});

describe("registry merge", () => {
  it("merges all 33 live markets with nothing unmatched", () => {
    expect(snap.markets.length).toBe(33);
    expect(snap.onlyInExchangeInfo).toEqual([]);
    expect(snap.onlyInMarketStats).toEqual([]);
  });

  it("B1: session map overrides an API 'Crypto' label and notes the mismatch", () => {
    const g = get("GOOGL-USD");
    expect(g.apiCategory).toBe("Crypto");
    expect(g.class).toBe("equity");
    expect(g.classSource).toBe("session_map");
    expect(g.notes.some((n) => n.startsWith("CATEGORY_MISMATCH"))).toBe(true);
    expect(get("SP500-USD").class).toBe("index");
  });

  it("no mismatch note when API and map agree", () => {
    const n = get("NVDA-USD");
    expect(n.class).toBe("equity");
    expect(n.notes.some((x) => x.startsWith("CATEGORY_MISMATCH"))).toBe(false);
    expect(n.sessionState.underlying).toBe("open");
  });

  it("crypto from the API with no map entry stays crypto, 24/7", () => {
    const b = get("BTC-USD");
    expect(b.class).toBe("crypto");
    expect(b.classSource).toBe("api");
    expect(b.sessionState.underlying).toBe("open");
  });

  it("unclear listings are equity with an unknown underlying", () => {
    for (const s of ["DRAM-USD", "SKHYNIX-USD", "ZHIPU-USD"]) {
      expect(get(s).sessionState.underlying).toBe("unknown");
      expect(get(s).notes).toContain("UNDERLYING_UNKNOWN");
    }
  });

  it("commodities carry the 'assumed' note", () => {
    expect(get("XAU-USD").class).toBe("commodity");
    expect(get("XAU-USD").notes.some((n) => n.startsWith("SESSION_ASSUMED"))).toBe(true);
  });

  it("extracts NVDA filters from the real response", () => {
    expect(get("NVDA-USD").filters).toEqual({
      tickSize: "0.01", minPrice: "0.01", maxPrice: "20000",
      stepSize: "0.01", minQty: "0.01", maxQty: "30000",
      marketStepSize: "0.01", marketMinQty: "0.01", marketMaxQty: "3000",
      minNotional: "10",
    });
  });

  it("fails closed (null filters) when a documented filter is missing", () => {
    const sym = info.symbols.find((s) => s.symbol === "NVDA-USD")!;
    const broken = { ...sym, filters: sym.filters.filter((f) => f.filterType !== "MIN_NOTIONAL") };
    expect(extractFilters(broken)).toBeNull();
    const snap2 = mergeMarkets({ ...info, symbols: info.symbols.map((s) => (s.symbol === "NVDA-USD" ? broken : s)) }, stats, now, now);
    const n = snap2.markets.find((m) => m.symbol === "NVDA-USD")!;
    expect(n.filters).toBeNull();
    expect(n.notes.some((x) => x.startsWith("FILTERS_MISSING"))).toBe(true);
  });

  it("a TradFi market missing from the session map is marked unknown", () => {
    const fake = stats.map((m) => (m.symbol === "MU-USD" ? { ...m, symbol: "NEWCO-USD" } : m));
    const infoFake = { ...info, symbols: info.symbols.map((s) => (s.symbol === "MU-USD" ? { ...s, symbol: "NEWCO-USD" } : s)) };
    const n = mergeMarkets(infoFake, fake, now, now).markets.find((m) => m.symbol === "NEWCO-USD")!;
    expect(n.class).toBe("equity");
    expect(n.sessionState.underlying).toBe("unknown");
    expect(n.notes.some((x) => x.startsWith("NO_SESSION_ENTRY"))).toBe(true);
  });
});
