// Response schemas derived from real responses in fixtures/live/ (Phase 0, 2026-10-22) and the
// OpenAPI specs in ref/strike-finance-skills/openapi. Live shape wins over spec (CLAUDE.md §2.1).
// Decimal values stay strings; z.object strips unknown keys.
import { z } from "zod";

const decStr = z.string();
const ms = z.number().int();

// GET /price/v2/exchangeInfo — fixtures/live/exchangeInfo.json
export const PriceFilter = z.object({ filterType: z.literal("PRICE_FILTER"), minPrice: decStr, maxPrice: decStr, tickSize: decStr });
export const LotSize = z.object({ filterType: z.literal("LOT_SIZE"), minQty: decStr, maxQty: decStr, stepSize: decStr });
export const MarketLotSize = z.object({ filterType: z.literal("MARKET_LOT_SIZE"), minQty: decStr, maxQty: decStr, stepSize: decStr });
export const MinNotional = z.object({ filterType: z.literal("MIN_NOTIONAL"), notional: decStr });
export const ExchangeSymbol = z.object({
  symbol: z.string(),
  status: z.string(), // lowercase: pre_trading | trading | break | close
  baseAsset: z.string(),
  pricePrecision: z.number().int(),
  quantityPrecision: z.number().int(),
  triggerProtect: decStr,
  liquidationFee: decStr,
  limitTakeBound: decStr,
  marketTakeBound: decStr,
  orderType: z.array(z.string()),
  timeInForce: z.array(z.string()),
  // Kept loose here; the registry extracts the four documented filter types and fails closed if one is missing.
  filters: z.array(z.record(z.string(), z.unknown())),
});
export const ExchangeInfo = z.object({ serverTime: ms, symbols: z.array(ExchangeSymbol) });
export type ExchangeInfo = z.infer<typeof ExchangeInfo>;
export type ExchangeSymbol = z.infer<typeof ExchangeSymbol>;

// GET /price/v2/marketStats — fixtures/live/marketStats.json ({status, data:[...]})
export const MarketStatsEntry = z.object({
  symbol: z.string(),
  category: z.string(), // "Crypto" | "TradFi" (see BLOCKERS B1)
  subCategory: z.string(), // "FX" | "Commodity" | "Equity" | "Index" | ""
  assetName: z.string(),
  active: z.boolean(),
  status: z.string(), // ACTIVE | PRE_TRADING | BREAK | CLOSED
  marketStats: z.object({
    volume24h: decStr,
    lastPrice: decStr,
    markPrice: decStr,
    indexPrice: decStr,
    fundingRate: decStr, // HOURLY rate (VERIFICATION.md Phase 0 #6)
    nextFundingRate: ms, // next funding TIME in ms despite the name
    openInterest: decStr,
    priceChangePercentage24h: decStr,
  }),
});
export const MarketStats = z.object({ status: z.string(), data: z.array(MarketStatsEntry) });
export type MarketStatsEntry = z.infer<typeof MarketStatsEntry>;

// GET /price/v2/markPrice — array without ?symbol (fixtures/live/markPrice.json)
export const MarkPrice = z.object({ e: z.string(), E: ms, s: z.string(), p: decStr, i: decStr, r: decStr, T: ms });
export const MarkPrices = z.array(MarkPrice);
export type MarkPrice = z.infer<typeof MarkPrice>;

// GET /price/v2/depth?symbol= — fixtures/live/depth_*.json
const level = z.tuple([decStr, decStr]);
export const Depth = z.object({ lastUpdateId: z.number().int(), E: ms, T: ms, bids: z.array(level), asks: z.array(level) });
export type Depth = z.infer<typeof Depth>;

// GET /price/v2/klines — 12-element rows, oldest first (fixtures/live/klines_NVDA-USD_1h_mark.json)
export const KlineRow = z.tuple([ms, decStr, decStr, decStr, decStr, decStr, ms, decStr, z.number().int(), decStr, decStr, decStr]);
export const Klines = z.array(KlineRow);
export interface Kline { openTime: number; open: string; high: string; low: string; close: string; volume: string; closeTime: number }

// GET /v2/fee-tiers — JSON numbers, PascalCase (fixtures/live/fee-tiers.json)
export const FeeTiers = z.object({
  feeTiers: z.array(z.object({ Tier: z.number().int(), MinVolume: z.number(), TakerRate: z.number(), MakerRate: z.number() })),
});
export type FeeTiers = z.infer<typeof FeeTiers>;

// GET /v2/credit/settings — fixtures/live/credit_settings.json
export const CollateralAssetSettings = z.object({
  asset_prec: z.number().int(),
  credit_admission_ratio: decStr, // M
  credit_collateral_reference_loss: decStr, // X
  credit_collateral_conversion_discount: decStr, // d
  collateral_sale_discount: decStr,
});
export const CreditSettings = z.object({
  effective_seq: z.number().int(),
  settings: z.object({
    collateral_assets: z.record(z.string(), CollateralAssetSettings),
    approved_vaults: z.record(z.string(), z.boolean()),
  }),
});
export type CreditSettings = z.infer<typeof CreditSettings>;

// GET /v2/credit/collateral-assets — fixtures/live/credit_collateral-assets.json
export const CollateralAsset = CollateralAssetSettings.extend({
  open_lines: z.number().int(),
  total_collateral_units: decStr,
  total_debt_usd: decStr,
  price: decStr.optional(), // present only when price_available
  price_available: z.boolean(),
  price_fresh: z.boolean(),
  price_observed_at: ms,
  price_expires_at: ms,
});
export const CollateralAssets = z.object({ effective_seq: z.number().int(), assets: z.record(z.string(), CollateralAsset) });
export type CollateralAssets = z.infer<typeof CollateralAssets>;

// GET /v2/vaults, /v2/vault/:id — fixtures/live/vaults_protocol.json, vault_slp.json
export const Vault = z.object({
  vault_id: z.string(),
  type: z.string(),
  name: z.string(),
  share_price: decStr,
  equity: decStr,
  total_shares: decStr,
  status: z.string(),
});
export const VaultList = z.object({ count: z.number().int(), vaults: z.array(Vault) });
export type Vault = z.infer<typeof Vault>;

// GET /v2/account — fixtures/live/account_vault_slp.json (public vault_id read) + user-api.yaml GetAccountResponse
export const Account = z.object({
  account_id: z.string(),
  wallet_balance: decStr,
  available_balance: decStr,
  unrealized_pnl: decStr,
  margin_balance: decStr,
  total_margin: decStr,
  position_initial_margin: decStr,
  maintenance_margin: decStr,
  default_margin_mode: z.string(),
  default_leverage: z.number().int(),
  symbol_settings: z.record(z.string(), z.object({ margin_mode: z.string(), leverage: z.number().int() })),
});
export type Account = z.infer<typeof Account>;

// GET /v2/positions — fixtures/live/positions_vault_slp.json + user-api.yaml Position
export const Position = z.object({
  id: z.number().int(),
  symbol: z.string(),
  margin_mode: z.enum(["cross", "isolated"]),
  leverage: z.number().int(),
  size: decStr, // signed: + long, − short
  entry_price: decStr,
  iso_balance: decStr,
  accumulated_funding_fees: decStr,
  upnl: decStr,
  maintenance_margin: decStr,
  bankruptcy_price: decStr, // "0" = none
  liquidation_price: decStr, // "0" = none
  create_timestamp: ms,
  update_timestamp: ms,
});
export const Positions = z.object({ count: z.number().int(), positions: z.array(Position) });
export type Position = z.infer<typeof Position>;

// GET /v2/openOrders — PascalCase engine model (fixtures/live/openOrders_vault_slp_NVDA.json; trade-api.yaml Order)
export const OpenOrder = z.object({
  ID: z.number().int(),
  ClientOrderID: z.string(),
  Symbol: z.string(),
  CloseReason: z.string(),
  Side: z.enum(["buy", "sell"]),
  Status: z.string(),
  Type: z.string(),
  Size: decStr,
  Filled: decStr,
  Price: decStr,
  StopPrice: decStr,
  ReduceOnly: z.boolean(),
  CreateTimestamp: ms,
});
export const OpenOrders = z.object({ count: z.number().int(), orders: z.array(OpenOrder) });
export type OpenOrder = z.infer<typeof OpenOrder>;

// GET /v2/history/order — snake_case (fixtures/live/history_order_vault_slp_NVDA.json; user-api.yaml)
export const HistoryOrder = z.object({
  id: z.number().int(),
  client_order_id: z.string().nullable(),
  symbol: z.string(),
  close_reason: z.string().nullable(),
  side: z.enum(["buy", "sell"]),
  status: z.string(),
  type: z.string(),
  size: decStr,
  filled: decStr,
  price: decStr,
  stop_price: decStr,
  reduce_only: z.boolean(),
  create_timestamp: ms,
  event_timestamp: ms,
});
export const HistoryOrders = z.object({ count: z.number().int(), orders: z.array(HistoryOrder) });
export type HistoryOrder = z.infer<typeof HistoryOrder>;

export const ServerTime = z.object({ serverTime: ms });

// GET /v2/markets (main host, public) — margin tiers etc. fixtures/live/markets.json; strike-calculations skill.
export const MarginTier = z.object({
  max_notional: decStr,
  max_leverage: z.number().int(),
  maintenance_margin_rate: decStr,
  maintenance_amount: decStr,
});
export type MarginTier = z.infer<typeof MarginTier>;
export const MarketInfo = z.object({
  symbol: z.string(),
  status: z.string(),
  quote_prec: z.number().int(),
  default_leverage: z.number().int(),
  margin_tiers: z.array(MarginTier).min(1),
  mark_price: decStr,
  index_price: decStr,
  funding_rate: decStr,
  next_funding_time: ms,
  liquidation_fee_rate: decStr,
  trigger_protect: decStr,
});
export type MarketInfo = z.infer<typeof MarketInfo>;
export const Markets = z.object({ markets: z.record(z.string(), MarketInfo) });

// GET /v2/balances — one-element array (fixtures/live/balances_vault_slp.json)
export const Balance = z.object({
  asset: z.string(),
  walletBalance: decStr,
  unrealizedPnl: decStr,
  marginBalance: decStr,
  maintMargin: decStr,
  positionInitialMargin: decStr,
  availableBalance: decStr,
  updateTime: ms,
});
export const Balances = z.array(Balance).min(1);
export type Balance = z.infer<typeof Balance>;
