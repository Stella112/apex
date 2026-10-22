# VERIFICATION — verified vs assumed

Legend: **VERIFIED-LIVE** = observed in a real response saved under `fixtures/live/`. **VERIFIED-SPEC** = read in `ref/strike-finance-skills` (OpenAPI/skills) or `ref/docs` (docs.strikefinance.org), not exercised live. **ASSUMED** = neither; needs confirmation.

## Phase 0 — 2026-10-22 19:21–19:30 UTC, env `mainnet`, public endpoints, no auth headers

Script: `pnpm phase0` (`scripts/phase0-verify.ts`). Result: **13/13 calls OK** (manifest `fixtures/live/_manifest.json`).

| Call | Status | Fixture |
|---|---|---|
| `GET /v2/time` | 200 | `time.json` → `{serverTime}` in ms |
| `GET /price/v2/exchangeInfo` | 200 | `exchangeInfo.json` (33 symbols) |
| `GET /price/v2/marketStats` | 200 | `marketStats.json` (33 markets) |
| `GET /price/v2/markPrice` | 200 | `markPrice.json` (array of 33) |
| `GET /price/v2/depth?symbol=BTC-USD` | 200 | `depth_BTC-USD.json` |
| `GET /price/v2/depth?symbol=NVDA-USD` | 200 | `depth_NVDA-USD.json` |
| `GET /price/v2/klines?symbol=NVDA-USD&interval=1h&priceType=mark&limit=1500` | 200 | `klines_NVDA-USD_1h_mark.json` (1500 rows) |
| `GET /v2/fee-tiers` | 200 | `fee-tiers.json` |
| `GET /v2/credit/settings` | 200 | `credit_settings.json` |
| `GET /v2/credit/collateral-assets` | 200 | `credit_collateral-assets.json` |
| `GET /v2/vaults?type=protocol` | 200 | `vaults_protocol.json` |
| `GET /v2/vault/3fd3ab0b-318b-4f99-9ad6-66e9e917bea8` | 200 | `vault_slp.json` |
| `GET` testnet `/price/v2/marketStats` | 200 | `testnet_marketStats.json` |
| `GET /v2/account`, `GET /v2/positions` | **SKIPPED** | no API wallet keys in `.env` yet |

### Findings

1. **Market classification — MISMATCH with CLAUDE.md §4.3/§6.1 (VERIFIED-LIVE).** `marketStats` returns `category:"Crypto", subCategory:""` for **AAOI, COIN, CRCL, DRAM, GOOGL, MINIMAX, SP500, UNITREE, ZHIPU**. Only CXMT, MU, NVDA, SKHYNIX, SNDK, SPCX, TSLA are `TradFi/Equity`; NAS100 `TradFi/Index`; WTI, XAG, XAU `TradFi/Commodity`. Following §6.1 literally would classify GOOGL/COIN/SP500 as crypto with no session risk. → Blocker **B1**.
2. **Symbol count:** 33 in both `exchangeInfo` and `marketStats` (VERIFIED-LIVE, matches §4.3).
3. **`marketStats` shape:** `{status, data:[...]}`; per market `symbol, type, category, subCategory, assetName, collateralAssetName, active, status, marketStats{volume24h, volumeBase24h, priceChange24h, priceChangePercentage24h, low24h, high24h, lastPrice, markPrice, indexPrice, fundingRate, nextFundingRate, openInterest, openInterestBase}, visibleOnUI, createdAt`. `nextFundingRate` is a number (ms timestamp) — matches §4.3. All 33 `status:"ACTIVE"` at capture time.
4. **`exchangeInfo` shape:** `{timezone, serverTime, rateLimits, symbols}`. Per symbol `status` is lowercase (`trading` for all 33), `pricePrecision`, `quantityPrecision`, `triggerProtect`, `liquidationFee`, `limitTakeBound`, `marketTakeBound`, `orderType`, `timeInForce`, `filters`.
   **Filter field names (VERIFIED-LIVE):** `PRICE_FILTER{minPrice,maxPrice,tickSize}`, `LOT_SIZE{minQty,maxQty,stepSize}` (limit orders), `MARKET_LOT_SIZE{minQty,maxQty,stepSize}` (market orders — NVDA maxQty 3000 vs 30000 for LOT_SIZE), `MIN_NOTIONAL{notional}`. All decimal strings. NVDA: tick 0.01, step 0.01, minQty 0.01, min notional 10.
   `exchangeInfo.orderType` lists uppercase `LIMIT, MARKET, STOP, STOP_MARKET, TAKE_PROFIT, TAKE_PROFIT_MARKET` (display list, Binance-style).
5. **Order `side`/`type` casing (VERIFIED-SPEC only):** `trade-api.yaml` enums `side: buy|sell`, `type: limit|market|stop|stop_limit|take_profit|…` (lowercase); `strike-trading` SKILL.md: "Enums are case-sensitive: side buy/sell, type lowercase, time_in_force GTC/IOC/FOK, working_type mark_price/contract_price. TWAP uses BUY/SELL." Not exercised live (no write sent; that needs keys + approval in Phase 6). Apex will send lowercase.
6. **`fundingRate` is the HOURLY rate (VERIFIED-LIVE + docs).** Most crypto markets show `0.0000125` = 0.01% (8h interest `I`) ÷ 8; docs `perpetuals/funding-rates.md` worked example uses "hourly Funding Rate +0.00125%, or 0.0000125". strike-market-data skill: `fundingRate` is the rate estimated from the active (current-hour) window — i.e. the predicted next payment, not the last settled one. TradFi markets mostly `0`.
7. **`markPrice`** (no symbol) returns an array of `{e:"markPriceUpdate", E, s, p, i, r, T}`; `r` equals `fundingRate`. Matches §4.3.
8. **`depth` shape:** `{lastUpdateId, E, T, bids:[[price,qty]...], asks:[[price,qty]...]}`, strings, 20 levels each at capture. `E`/`T` ms timestamps → usable for the 10 s freshness rule.
9. **Klines (NVDA 1h mark):** 1500 rows = 2026-08-21 08:00 → 2026-10-22 19:00 UTC, 12-element rows, prices as strings, `trades` a number. **Mark klines: volume is `0`/`"0.00000000"` on 1183 of 1500 rows and 0 rows are perfectly flat (O=H=L=C).** The NVDA mark keeps moving during closed US hours, so "flat + zero volume" alone will rarely fire `STALE_MARK`; zero volume on mark klines is not a staleness signal. Phase 4 will detect flatness on mark (unchanged close across N rows) and must not use volume from mark klines.
10. **Fee tiers (VERIFIED-LIVE):** `{feeTiers:[{Tier,MinVolume,TakerRate,MakerRate}], makerRebateTiers:[{tier,minMakerVolumeShare,makerRate}], ...}` — PascalCase, JSON **numbers** (not strings; convert via `new Decimal(String(x))`). Base tier 0: TakerRate `0.0005`, **MakerRate `-0.00005`** (a rebate). **Mismatch with strike-calculations skill example** (`MakerRate: 0`); live wins.
11. **Credit settings (VERIFIED-LIVE)** match §4.7 field names. Assets: `ADA` (M `1`, X `0.3`, d `0.05`, sale `0.02`, prec 6), `LP_SUNDAE_USDCx_USDM` (X 0.1), `SCALED_AAVE_V3_ETH_aUSDC` (X 0.05), `sUSDrf` (X 0.1). `approved_vaults` = SLP `3fd3ab0b-318b-4f99-9ad6-66e9e917bea8`. ADA X=0.30 and d=0.05 match the doc's worked examples.
12. **Credit collateral-assets (VERIFIED-LIVE):** `{effective_seq, assets:{<id>:{…settings, open_lines, total_collateral_units, encumbered_shares_by_vault, total_debt_usd, price, price_available, price_fresh, price_observed_at, price_expires_at, price_sequence_id, yield_apr, yield_apr_method}}}`. ADA price `0.21301…` at capture.
13. **No per-user credit-line read endpoint** in the OpenAPI specs, the skills, or docs `api/credit*.md` (only `settings`, `collateral-assets`, `models`). §4.7 fallback (user-entered `q`, `D`, `s`) stands.
14. **Vaults:** list shape `{count, limit, offset, vaults:[...]}`; id field is **`vault_id`** (not `id`). SLP `share_price` `1.1577…`, `equity ~1.04M`, `leader_commission_bps 0`. `GET /v2/vault/:id` returns the same object plus all-time totals.
15. **Testnet:** `marketStats` lists only **4 markets (ADA, BTC, ETH, SOL — all Crypto)**. No TradFi on testnet → the Weekend Shield / NVDA demo needs mainnet reads.
16. **Auth details (VERIFIED-SPEC, strike-auth skill), refining §4.2:** nonce 16–128 chars (UUID v4 OK); timestamp ≤180 s old and **never in the future** — sync with `GET /v2/time` and sign ~1 s behind server time; `BODY_HASH` for no body is sha256("") = `e3b0c442…b855`, never an empty string; rate limit 429 per public key.
17. `/v2/fee-tiers`, `/v2/credit/*`, `/v2/vaults`, `/v2/vault/:id`, `/v2/time` live on the main host (no `/price` prefix) — VERIFIED-LIVE.

### Assumed / still open
- Live order casing and async rejection behavior — Phase 6 with keys + approval.
- Account/positions shapes — need keys (Phase 1 smoke).
- Liquidation/margin-tier formulas — to read from `strike-calculations` in Phase 3.
- Session hours for non-US listings — `unknown` per §6.1.

### Tooling
- Dev dependency `@types/node` added (types only, needed for TS strict with `node:` imports). Installed versions: typescript ^7.0.2, tsx ^4.23.15, vitest ^5.0.5, dotenv ^18.0.9.

## Phase 1 — 2026-10-22 ~19:40 UTC

18. **Account reads verified live without keys** via the documented public `vault_id` selector (strike-auth: FlexibleAuth; user-api.yaml `VaultIdQuery`) on the SLP vault: `GET /v2/account`, `/v2/positions`, `/v2/openOrders?symbol=NVDA-USD`, `/v2/history/order?symbol=NVDA-USD&limit=5` all 200. Fixtures: `account_vault_slp.json`, `positions_vault_slp.json`, `openOrders_vault_slp_NVDA.json`, `history_order_vault_slp_NVDA.json`. Position fields match §4.4 exactly (`leverage` is an integer; `size` signed string; `liquidation_price` `"0"` = none).
19. **Casing differs by endpoint (VERIFIED-LIVE):** `/v2/openOrders` returns PascalCase engine keys (`ID, ClientOrderID, Side, Status, Type, Size, Filled, Price, StopPrice, ReduceOnly, …`); `/v2/history/order` returns snake_case (`id, client_order_id, side, status, …`, `client_order_id`/`close_reason` may be `null`). Order enums are lowercase in both (`buy`, `limit`, `open`, `GTC`).
20. **B1 resolved (Maris):** a cited `config/sessions.ts` entry overrides the API category, with a `CATEGORY_MISMATCH` note. Smoke run shows the note on AAOI, COIN, CRCL, DRAM, GOOGL, MINIMAX, SP500, UNITREE, ZHIPU.
21. **NYSE calendar (VERIFIED, nyse.com/trade/hours-calendars fetched 2026-10-22):** core session 09:30–16:00 ET; 2026 remaining: Thu Nov 26 closed, Fri Nov 27 13:00 early close, Thu Dec 24 13:00 early close, Fri Dec 25 closed — matches CLAUDE.md §6.1. 2027 holidays also loaded. Nasdaq is **assumed** to share the calendar.
22. **Assumed:** CME Globex hours (no CME holidays modeled); SP500/NAS100 follow the US cash session; listing venue (Nasdaq vs NYSE) per equity is informational only.
23. Dev dependency `@types/luxon` added (types only).

## Phase 2 — 2026-10-22 ~19:46 UTC
24. Referee is pure and uses only policy + context numbers; no Strike calls. Freshness limits from `config/thresholds.ts` (CLAUDE.md §6.2). Trigger-direction rule for R11 from CLAUDE.md §4.5 / trade-api.yaml.
25. **Assumed:** stop orders validated against both LOT_SIZE and MARKET_LOT_SIZE; MIN_NOTIONAL also applied to reduce-only orders (conservative — whether Strike exempts reduce-only from MIN_NOTIONAL is undocumented).
26. **Open interpretation (B3):** R4 concentration denominator.
27. Decision log: hash = sha256(prevHash + canonicalJSON(entry sans hash/sig)), Ed25519 over the 32 hash bytes with a separate key (`LOG_SIGNING_KEY` or generated `keys/log_signing.key`).

## Phase 3 — 2026-10-22 ~19:57 UTC
28. `GET /v2/markets` (main host, public) VERIFIED-LIVE: `{markets:{<symbol>:{margin_tiers[{max_notional,max_leverage,maintenance_margin_rate,maintenance_amount}], quote_prec, default_leverage, mark_price, funding_rate, next_funding_time, liquidation_fee_rate, order_* filters, ...}}}` (fixtures/live/markets.json). NVDA max leverage 20x, tier 0 MMR 0.01 up to $50k.
29. `GET /v2/balances?vault_id=` VERIFIED-LIVE: one-element array, `walletBalance` etc. (fixtures/live/balances_vault_slp.json).
30. **Liquidation formula VERIFIED-LIVE:** strike-calculations LP/BP formulas reproduce Strike's `liquidation_price` for **33/33** SLP vault positions (cross profile, 33 positions) — within 0.002% on fixtures, 0% on a simultaneous live fetch. Test: `circuit.test.ts` "VALIDATION"; live: `pnpm circuit`.
31. **Decided (Claude, per Maris delegation):** with no account data, Circuit treats a new trade as isolated with iso_balance = ceil(notional/leverage) and labels it "isolated-equivalent". With a LIVE account, it uses the account's margin mode per symbol (`symbol_settings`, else `default_margin_mode`).
32. Fees: base tier 0 only (taker 0.0005, maker −0.00005); account tier, referral and staking discounts not applied — labeled in output.
