// Public market data. Paths and params: ref/strike-finance-skills/openapi/market-api.yaml;
// shapes verified against fixtures/live/ (VERIFICATION.md Phase 0).
import type { Fetched, StrikeClient } from "./http.js";
import {
  CollateralAssets, CreditSettings, Depth, ExchangeInfo, FeeTiers, type Kline, Klines, MarkPrices,
  MarketStats, Vault, VaultList,
} from "./schemas.js";

export const KLINE_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"] as const;
export type KlineInterval = (typeof KLINE_INTERVALS)[number];
export type PriceType = "last" | "mark" | "index";

export const getExchangeInfo = (c: StrikeClient) => c.marketGet("/v2/exchangeInfo", undefined, ExchangeInfo);
export const getMarketStats = (c: StrikeClient, symbol?: string) => c.marketGet("/v2/marketStats", { symbol }, MarketStats);
export const getMarkPrices = (c: StrikeClient) => c.marketGet("/v2/markPrice", undefined, MarkPrices);
export const getDepth = (c: StrikeClient, symbol: string, limit?: number) => c.marketGet("/v2/depth", { symbol, limit }, Depth);
export const getFeeTiers = (c: StrikeClient) => c.publicGet("/v2/fee-tiers", undefined, FeeTiers);
export const getCreditSettings = (c: StrikeClient) => c.publicGet("/v2/credit/settings", undefined, CreditSettings);
export const getCollateralAssets = (c: StrikeClient) => c.publicGet("/v2/credit/collateral-assets", undefined, CollateralAssets);
export const getProtocolVaults = (c: StrikeClient) => c.publicGet("/v2/vaults", { type: "protocol" }, VaultList);
export const getVault = (c: StrikeClient, vaultId: string) => c.publicGet(`/v2/vault/${encodeURIComponent(vaultId)}`, undefined, Vault);

export interface KlineQuery {
  symbol: string;
  interval: KlineInterval;
  priceType?: PriceType;
  startTime?: number;
  endTime?: number;
  /** Max 1500 (CLAUDE.md §4.3). */
  limit?: number;
}

/** Klines as objects, oldest first. Rows older than `startTime` are dropped (CLAUDE.md §4.3). */
export async function getKlines(c: StrikeClient, q: KlineQuery): Promise<Fetched<Kline[]>> {
  if (q.limit !== undefined && (q.limit < 1 || q.limit > 1500)) throw new Error("klines limit must be 1..1500");
  const res = await c.marketGet(
    "/v2/klines",
    { symbol: q.symbol, interval: q.interval, startTime: q.startTime, endTime: q.endTime, limit: q.limit, priceType: q.priceType },
    Klines,
  );
  const rows = res.data
    .filter((r) => q.startTime === undefined || r[0] >= q.startTime)
    .map((r): Kline => ({ openTime: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], closeTime: r[6] }));
  return { ...res, data: rows };
}
