# APEX — Build Mandate for Claude Code

> Read this whole file before doing anything. It is the single source of truth for scope, process and rules.
> If anything here conflicts with a later chat instruction from Maris, ask which one wins before acting.

---

## 0. Mission and deadline

**Product:** Apex — the 24/7 AI trading, risk and execution desk for Strike Finance (perpetuals exchange; Cardano, Ethereum and Solana wallets).
**Event:** Strike Hackathon. Building period started Wed Oct 21, 2026, 10:00 AM EST. **Submission deadline: Fri Oct 23, 2026, 10:00 AM EST** (treat as **14:00 UTC / 15:00 Lagos** to be safe). Winners announced Mon Oct 26.
**Builder:** Maris (solo). GitHub: `Stella112`. Maris's local time zone is Africa/Lagos (UTC+1).

**One-liner:** Apex is an AI risk copilot and MCP service for Strike. Traders analyze and trade Strike's markets (crypto, stocks, indices, commodities) from Claude (and ChatGPT once hosted), simulate a trade's risk before execution (Circuit), protect positions against weekend/closed-session gaps (Weekend Shield), monitor Borrow-and-Earn credit lines (Credit Line Copilot), and watch a rule-governed vault (Mandate Vault). A trade-only API wallet plus a deterministic risk referee enforce user limits.

**Judging criteria (equal weight, from the official post):** Innovation, Integration with Strike, Utility and Impact, Technical Execution, Future Potential.

**Submission must include:** working prototype, documentation (what it does + how it uses Strike), a demo (video or live), and source code on GitHub. Work must be original and built during the hackathon.

---

## 1. Your role (Claude Code)

You are the **senior engineer executing a fixed, pre-agreed scope** for Maris. You are not the product owner.

You MUST:
- Build only what this file lists, in the phase order in §9, gated by acceptance checks.
- Ground every Strike integration detail in the sources listed in §3, in that priority order.
- Run code and tests yourself and show real output before claiming anything works.
- Keep a running log of what was verified vs assumed in `VERIFICATION.md`.
- Keep `docs/IMPLEMENTATION_STATUS.md` and `docs/BLOCKERS.md` current (format in §13).
- Commit after each phase passes, with a clear message.
- Stop and ask Maris at every trigger in §2.3.

You MUST NOT:
- Invent endpoints, fields, enum values, parameters, fee rates, margin rules or formulas. If it is not in the sources (§3) or observed in a real API response, it does not exist.
- Present mock, fixture or simulated data as live. Every number shown to a user is labeled `LIVE`, `PAPER` or `SCENARIO`.
- Add features, pages, tools, dependencies or abstractions not listed here ("while I'm at it" is forbidden).
- Edit, weaken, skip or delete a test to make it pass. Fix the code, or stop and report.
- Place any live order, or change leverage/margin on a live account, without Maris's explicit in-chat approval for that specific action.
- Commit secrets. Ever.
- Claim something is "done", "working" or "tested" without the command output that proves it.

---

## 2. Hard rules

### 2.1 Anti-hallucination protocol
1. Before writing any Strike API call, open the matching operation in the OpenAPI spec or skill (§3) and copy the exact path, method, field names and enum values.
2. In Phase 0 you call every **public** endpoint we depend on, save one real response per endpoint to `fixtures/live/<name>.json`, and generate types from what actually came back.
3. When the spec and a live response disagree, the live response wins. Record the difference in `VERIFICATION.md`.
4. When something is undocumented (for example a per-user credit-line endpoint), do **not** guess a path. Implement the documented fallback in this file and label it.
5. Every formula in code carries a comment citing its source (doc URL or skill file + section).
6. If you are unsure, say "I don't know" and propose how to find out. Do not fill gaps with plausible-looking code.

### 2.2 Money-safety rules
- All prices, sizes, balances and amounts are **decimal strings**. Use `decimal.js` for all money math. No JS `number` for sizes, prices or USD amounts.
- Round prices to `tickSize` and sizes to `stepSize` from `/v2/exchangeInfo` filters, and check min quantity and min notional before any order. Field names must come from the real response.
- Default mode is **PAPER**. LIVE requires all of: `APEX_MODE=live` in env, a referee approval, and a per-action human confirmation (two-step propose → confirm; see §6.4).
- **Fail closed:** missing data, stale data (older than the freshness limits in §6.2), unknown symbol, auth failure, or any non-2xx response means the action is blocked, not retried blindly.
- **No blind retries on writes.** Strike writes are async and not idempotent. Use `client_order_id` and reconcile before any resend.
- The API wallet can trade but **cannot withdraw or deposit** (documented). Apex never touches deposits, withdrawals, vault deposits/withdrawals, or credit draws/repayments.

### 2.3 Stop-and-ask triggers (stop and message Maris)
- Before any LIVE write (order, cancel, leverage, margin mode, isolated margin).
- An endpoint or field we need is missing or behaves differently from the spec.
- A test still fails after two honest fix attempts.
- Any change to scope, the tool list, the stack, or the phase order.
- Any ambiguity in money logic (sizing, liquidation math, fees, credit math).
- A phase is running more than ~50% over its time budget (§9). Propose what to cut.

### 2.4 Secrets
- Keys live only in `.env` (gitignored). Commit `.env.example` with placeholder values only.
- Never print private keys in logs, errors, MCP tool output or the dashboard.
- `.gitignore` must include `.env`, `*.key`, `logs/`, `node_modules/` and `dist/`.

---

## 3. Sources of truth (priority order)

1. **Live API responses** saved in Phase 0 (`fixtures/live/`).
2. **Strike OpenAPI specs:** `https://github.com/strike-finance/strike-finance-skills/tree/main/openapi` → `market-api.yaml`, `trade-api.yaml`, `user-api.yaml`. Clone the repo into `ref/` (gitignored) and read from there.
3. **Strike skills** (same repo, `skills/*/SKILL.md`), including `strike-auth`, `strike-market-data`, `strike-trading`, `strike-account`, `strike-calculations` (liquidation, PnL, margin tiers, available balance), `strike-history`, `strike-vaults`, `strike-userstream` and `strike-price-feeds`. You can also install them: `npx strike-finance-skills install --agents claude --yes`.
4. **Strike docs** (append `.md` for markdown; full index at `https://docs.strikefinance.org/llms.txt`):
   - API getting started / auth: `https://docs.strikefinance.org/api/getting-started.md`
   - Builder codes: `https://docs.strikefinance.org/api/builder-codes.md`
   - Vault leader: `https://docs.strikefinance.org/api/vault-leader.md`
   - Credit settings: `https://docs.strikefinance.org/api/credit/settings.md`
   - Credit collateral assets: `https://docs.strikefinance.org/api/credit/collateral.md`
   - Borrow and Earn mechanics (credit math): `https://docs.strikefinance.org/perpetuals/vaults/borrow-and-earn.md`
   - Funding rates: `https://docs.strikefinance.org/perpetuals/funding-rates.md`
   - Prices (mark/index rules): `https://docs.strikefinance.org/perpetuals/prices.md`
   - Liquidations, margin tiers, trading fees, order types: under `https://docs.strikefinance.org/perpetuals/`
5. **Builder reference app:** `https://github.com/strike-finance/strike-builder-reference`
6. **MCP:** official TypeScript SDK `@modelcontextprotocol/sdk` (read its README for the current API before coding; do not code from memory).

---

## 4. Verified Strike facts (checked Oct 22, 2026 — still re-verify in Phase 0)

### 4.1 Hosts
| Purpose | Mainnet | Testnet |
|---|---|---|
| Trade/User REST | `https://api.strikefinance.org` | `https://api-v2-testnet.strikefinance.org` |
| Market data REST | `https://api.strikefinance.org/price` (paths appended, e.g. `/price/v2/depth`) | `https://api-v2-testnet.strikefinance.org/price` |
| Public WS | `wss://api.strikefinance.org/ws/price` | (verify) |
| User WS | `wss://api.strikefinance.org/ws/user-api` | (verify) |

### 4.2 Auth (API wallet, Ed25519)
- Headers on every authenticated request: `X-API-Wallet-Public-Key` (64 lowercase hex), `X-API-Wallet-Signature` (hex), `X-API-Wallet-Timestamp` (Unix **seconds**), `X-API-Wallet-Nonce` (UUID v4, unique per request).
- Signed message: `{METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH}`
  - `METHOD`: uppercase.
  - `PATH`: full path **including query string**, e.g. `/v2/positions?symbol=BTC-USD`.
  - `BODY_HASH`: SHA-256 hex of the **exact JSON string sent** (serialize once and send that same string); for GET, hash the empty string.
- Timestamp must be within 3 minutes of server time; nonces cannot repeat.
- Library: `@noble/ed25519` v2 with `ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m))`, importing `sha512` from `@noble/hashes/sha2.js` (v2 uses `.js` subpaths). Private key is a 32-byte seed; if 64 bytes are given, use the first 32.
- Key setup: Maris generates a key pair and registers the public key at `https://app.strikefinance.org/api-keys`. The wallet can view the account, place and cancel orders, change leverage and view history. It **cannot** withdraw or deposit.
- When `X-API-Wallet-Public-Key` is present, the request is fully verified as an API-wallet request; any failure returns 401, even on public reads. Do not send auth headers on public market-data calls.

### 4.3 Market data (public, no auth; prefix `/price`)
- `GET /v2/exchangeInfo` — all symbols, precision and filters (tick size, step size, min quantity, notional, …). As of Oct 22 it returned **33 symbols**.
- `GET /v2/marketStats[?symbol=]` — per market: `category` (`Crypto` or `TradFi`), `subCategory` (`FX`, `Commodity`, `Equity`, `Index`, or `""`), `status` (`ACTIVE`, `PRE_TRADING`, `BREAK`, `CLOSED`), and `marketStats` with `lastPrice`, `markPrice`, `indexPrice`, `fundingRate`, `nextFundingRate` (**this is the next funding TIME in ms**, despite the name), `openInterest`, `volume24h` (quote) and others. Errors return `{"error": ...}`.
- `GET /v2/markPrice[?symbol=]` → `{e, E, s, p (mark), i (index), r (funding rate), T (next funding time)}`.
- `GET /v2/indexPrice`, `GET /v2/premiumIndex`, `GET /v2/ticker/24hr`, `GET /v2/ticker/price`, `GET /v2/ticker/bookTicker`.
- `GET /v2/depth?symbol=` — order book (read the spec for params and shape).
- `GET /v2/klines?symbol=&interval=&startTime=&endTime=&limit=&priceType=` — `interval` ∈ `1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w 1M` (case-sensitive); `limit` max 1500 (default 500); `priceType` ∈ `last | mark | index`. Each row is a 12-element array `[openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, …]`, oldest first. Gaps are filled with flat candles at the previous close and zero volume. With `endTime` set, rows older than `startTime` may appear — drop them.
- `GET /v2/openInterest`.
- Symbols are canonical uppercase like `BTC-USD`, `NVDA-USD`. Most endpoints are case-sensitive.
- Error format: `{"code": "...", "msg": "..."}`, except `/v2/marketStats` and `/v2/sparklines`, which return `{"error": "..."}`.
- Responses are cached ~5 s (`X-Cache` header).
- `GET /v2/fee-tiers` is a public route on the main host (listed in the `strike-auth` skill). Read its real response before computing fees.

**Markets observed Oct 22 (33):** Crypto — BTC, ETH, XRP, ADA, DOGE, BNB, SOL, NEAR, ZEC, HYPE, PUMP, NIGHT, LIT. Equities — TSLA, NVDA, GOOGL, MU, SNDK, SKHYNIX, AAOI, CRCL, COIN, DRAM, SPCX, UNITREE, MINIMAX, ZHIPU, CXMT. Indices — SP500, NAS100. Commodities — WTI, XAU, XAG. **Use `/v2/marketStats` category/subCategory at runtime; do not hard-code this list.**

### 4.4 Account (FlexibleAuth; use API wallet auth)
- `GET /v2/account` — balances, margin totals, `default_margin_mode`, `default_leverage`, `symbol_settings`.
- `GET /v2/balances`, `GET /v2/portfolio`.
- `GET /v2/positions[?symbol=]` → `{positions: [...], count}`. Each position has `id`, `symbol`, `margin_mode` (`cross` | `isolated`), `leverage`, `size` (signed string; + long, − short), `entry_price`, `iso_balance`, `accumulated_funding_fees`, `upnl`, `maintenance_margin`, `bankruptcy_price`, `liquidation_price` (`"0"` = none), plus timestamps.
- `GET /v2/openOrders`, `GET /v2/history/order`, `/v2/history/fill`, `/v2/history/funding`, `/v2/history/transaction`.
- `GET /v2/symbols` (auth required) — effective margin mode and leverage per market.
- All of these accept `vault_id` as a **query** parameter for vault accounts.

### 4.5 Trading (auth required)
- `POST /v2/order` → `201` with status `pending` once sequenced. Market, margin and position checks happen **asynchronously** in the engine; you must reconcile.
  - `type`: `limit` (needs `price`), `market` (optional `slippage`, e.g. `"0.01"`), `stop` / `take_profit` (need `stop_price`), `stop_limit` / `take_profit_limit` (need `stop_price` + `price`), `trailing_stop_market` (needs `callback_rate` and `reduce_only: true`).
  - Body fields (spec): `client_order_id`, `symbol`, `side`, `type`, `size`, `price`, `stop_price`, `time_in_force` (`GTC`/`IOC`/`FOK`), `working_type`, `post_only`, `reduce_only`, `close_position`, `price_protect`, `callback_rate`, `activation_price`, `slippage`, `vault_id`, `sub_account_id`.
  - Spec examples use **lowercase** `side` and `type` (`buy`, `sell`, `limit`). Confirm the accepted casing in Phase 0 and record it.
  - Trigger direction: `stop*` sell triggers when price ≤ stop_price, buy when ≥; `take_profit*` sell when ≥, buy when ≤. A conditional order that would trigger immediately is **rejected**.
- `POST /v2/order/strategy` — bracket: primary order plus `tp_order` / `sl_order` legs; legs activate only after the primary fills. **To protect an EXISTING position, use standalone reduce-only `stop` / `take_profit` orders via `POST /v2/order`, not strategy.**
- `DELETE /v2/order/cancel` with body `{order_id, symbol}`; `DELETE /v2/order/cancel-all`.
- `POST /v2/leverage` `{symbol, leverage}`. The engine rejects a **decrease on an isolated position**, and a cross decrease without enough balance.
- `POST /v2/marginMode` `{symbol, marginMode}` — refused while a position or orders are open. Apex must not propose this for open positions.
- `POST /v2/isoMargin` `{symbol, amount, modify_type: "add" | "remove"}` — isolated positions only.
- Optional header `X-Builder-Fee-Bps` (integer bps). It only applies when the API wallet was created through **builder connect** with a builder code. With a personal API wallet, do not send it. Builder connect is P2 (§8).

### 4.6 Vaults
- `GET /v2/vaults?type=protocol` finds the SLP vault; `GET /v2/vault/:id` returns `share_price`, `equity` and other fields. Public.
- Vault leader: same auth; add `vault_id` in the **body** for trade writes and as a **query** parameter for reads. User vaults charge a 10% default leader fee, and the leader must keep 5% of shares.
- Apex does not create, deposit into or withdraw from vaults in code.

### 4.7 Credit (Borrow and Earn)
- `GET /v2/credit/settings` → `{effective_seq, settings: {collateral_assets: {<asset>: {asset_prec, credit_admission_ratio, credit_collateral_reference_loss, credit_collateral_conversion_discount, collateral_sale_discount}}, custody_asset_mappings, approved_vaults}}`.
- `GET /v2/credit/collateral-assets` → per asset: settings plus totals (`open_lines`, `total_collateral_units`, `total_debt_usd`, …), and price fields `price`, `price_available`, `price_fresh`, `price_observed_at`, `price_expires_at`, plus yield fields.
- **There is no documented per-user credit-line read endpoint.** Fallback: the user enters line values (collateral units `q`, debt `D`, encumbered SLP shares `s`); Apex fetches the collateral price `P` and the SLP `share_price` `S` live. Label this clearly as "user-entered line values". Do not guess an endpoint. If Phase 0 finds a real one in the spec or skills, record it and ask Maris before switching.
- Shared parameters not exposed by the settings endpoint come from the doc (current launch values): `Y = 0.20`, `F = 0.50`, `r = 0.05`. Put them in `config/credit.ts` with a source comment.

### 4.8 Funding (for display and cost estimates)
- Paid **hourly** on the UTC hour.
- `Funding Transfer = −SignedSize × Mark × HourlyRate`; positive rate means longs pay shorts.
- Hourly rate = 8h-basis rate ÷ 8. The 8h rate is clamped to ±4% (hourly ±0.5%).
- Profiles: Crypto `I = 0.01%`, `D = 0`; TradFi/RWA `I = 0`, `D = 0.05%`.
- Verify whether `fundingRate` from the API is the hourly or the 8h-basis value, and record the answer in `VERIFICATION.md`.

### 4.9 Prices
- An index source older than 5 s drops out. If no sources remain, the **last mark stays** until data returns.
- Consequence for Apex: a stock perp in a closed underlying session can show an unchanging mark. Detect a flat mark (for example, unchanged across N klines with zero volume) and flag it as `STALE_MARK` in risk output.

---

## 5. Scope

### P0 — must ship (the demo depends on it)
1. **Apex Core**: Strike client (signing, REST, typed responses), market registry, Risk Referee, policy, decision log.
2. **Circuit** (pre-trade simulator): liquidation estimate, fees, order-book slippage, portfolio impact, stress tests at 2/5/8% and custom, policy verdict, compliant alternative.
3. **Weekend Shield**: underlying-session awareness, gap-risk score per position, protection proposals.
4. **Protected execution**: propose → referee → human confirm → execute → reconcile, for (a) a reduce-only protective stop on an existing position and (b) a partial reduce-only market close. Default PAPER; LIVE only as in §2.2.
5. **MCP server** (stdio for Claude Desktop / Claude Code) with the tools in §7.
6. **Dashboard**: markets radar, Circuit panel, positions plus risk, decision log, mode badges.

### P1 — ship if P0 is green
7. **Credit Line Copilot**: health, recovery boundary, stress heatmap, fix amounts (exact doc formulas, §6.6).
8. **Fair-value bands** for equity and index perps (labeled estimates).
9. **Streamable HTTP transport** for the MCP server (prepares ChatGPT/remote hosting).

### P2 — paper or roadmap only
10. **Mandate Vault** in PAPER mode: published mandate, signal, referee decisions, paper fills, log.
11. Builder connect plus builder fees, Telegram alerts, on-chain anchoring of the log, hosted deployment. README "Roadmap" only, unless Maris asks.

### Out of scope (do not build)
Deposits, withdrawals, vault create/deposit/withdraw, credit draws/repayments, copy trading, grid/TWAP bots, RFQ, user accounts or login, a database server, auth for the dashboard beyond localhost, mobile apps, a token, any smart contract.

---

## 6. Functional specifications

### 6.1 Market registry and sessions
- On start (and every 60 s), load `/v2/exchangeInfo` and `/v2/marketStats` and merge them by symbol.
- Market class: `crypto` if `category == "Crypto"`; else `equity | index | commodity | fx` from `subCategory`.
- **Underlying session map** in `config/sessions.ts`. One explicit entry per TradFi symbol: `{symbol, venue, tz, schedule, source}`. Rules:
  - US equities (TSLA, NVDA, GOOGL, MU, SNDK, AAOI, CRCL, COIN, and others Maris confirms): NYSE/Nasdaq regular session, 09:30–16:00 America/New_York, Mon–Fri, minus NYSE holidays. 2026 dates still ahead: **Thu Nov 26 (closed)**, **Fri Nov 27 (13:00 early close)**, **Thu Dec 24 (13:00 early close)**, **Fri Dec 25 (closed)**. Verify against `https://www.nyse.com/markets/hours-calendars` and cite it.
  - Indices SP500 / NAS100: treat as the US cash session, labeled "assumed — verify the reference feed".
  - Commodities WTI / XAU / XAG: CME Globex, Sun 18:00 → Fri 17:00 America/New_York, with a daily 17:00–18:00 break. Label "assumed — verify".
  - Non-US or unclear listings (SKHYNIX, CXMT, UNITREE, MINIMAX, ZHIPU, SPCX, DRAM, and any symbol you can't map with a cited source): `session: "unknown"`. **Do not guess.** Show "underlying session unknown" and treat as closed-session risk in scoring (conservative).
- Use `Intl.DateTimeFormat` / `Temporal` polyfill or `luxon` for time zones; no manual UTC-offset math.
- Output per market: `{symbol, class, perpStatus (from API), underlying: "open" | "closed" | "unknown", nextOpen, nextClose, source}`.

### 6.2 Data freshness (fail-closed limits)
- Mark price older than 15 s, depth older than 10 s, or account/positions older than 15 s: block execution and Circuit verdicts (Circuit still shows numbers, marked STALE).
- Klines are used for statistics only, never for execution prices.

### 6.3 Risk Referee (deterministic, pure functions, 100% unit-tested)
`evaluate(action, context, policy) → {decision: "APPROVE" | "BLOCK", violations: Rule[], warnings: Rule[], alternative?: Action}`

Default policy (`config/policy.default.json`; user-editable via the `set_policy` tool):
```json
{
  "maxLeverage": 5,
  "maxPositionNotionalUsd": "500",
  "maxPortfolioNotionalUsd": "2000",
  "maxSingleMarketConcentrationPct": "40",
  "minLiquidationDistancePct": "15",
  "allowedClasses": ["crypto", "equity", "index", "commodity"],
  "blockedSymbols": [],
  "weekend": { "maxLeverageWhenUnderlyingClosed": 3, "blockNewPositionsWhenUnderlyingClosed": false },
  "maxActionsPerHour": 10,
  "requireHumanConfirm": true
}
```
Rules (each with an id, a human message and the numbers behind it):
- `R1` leverage ≤ max (closed-session max when the underlying is closed or unknown)
- `R2` position notional ≤ max
- `R3` resulting portfolio notional ≤ max
- `R4` resulting concentration ≤ max
- `R5` estimated liquidation distance ≥ min
- `R6` market class and symbol allowed
- `R7` market `status == ACTIVE`
- `R8` data fresh (§6.2)
- `R9` action rate ≤ max
- `R10` order passes exchange filters (tick, step, min quantity, min notional)
- `R11` protective orders do not trigger immediately and are reduce-only
- `R12` mode is permitted (LIVE requires env flag + confirmation)
- **Reductions** (reduce-only stops, reduce-only partial closes, isolated margin adds) are always allowed past R1–R5 but still pass R7, R8, R10, R11 and R12.
- **Alternative generator:** if R1, R2 or R5 fails, compute the largest compliant size at the allowed leverage (respecting step size and min notional) and return it as an alternative, including its own Circuit numbers.

### 6.4 Execution flow (PAPER default, LIVE gated)
1. `propose_*` builds an `Action`, runs Circuit and the referee, stores a **proposal** `{id, action, circuit, verdict, paramsHash, expiresAt = now + 120 s}` and returns it. Nothing is sent to Strike.
2. `execute_proposal(id, confirm: true)` re-fetches fresh data, re-runs the referee, checks `paramsHash` and expiry, then:
   - PAPER: simulates the fill (market: walk current depth; stop: rests as a simulated order) and records it.
   - LIVE: sends the order with a unique `client_order_id`, then **reconciles** by polling `GET /v2/openOrders` / `GET /v2/history/order` until the order is accepted and resting, filled or rejected, or 20 s pass. The reported status comes from Strike, never assumed.
3. Every step writes to the decision log.
4. Protective stop for a long: `side=sell, type=stop, stop_price < mark, reduce_only=true, size = |position size|` (or the chosen fraction). For a short, mirror it. Partial close: `type=market, reduce_only=true, slippage` from policy (default `"0.01"`).

### 6.5 Circuit (pre-trade simulator)
Input: `{symbol, side, notionalUsd | size, leverage, orderType, limitPrice?, stopLoss?, takeProfit?}`.
Outputs (each with a `basis` field naming the data used and a `label`: LIVE / ESTIMATE / SCENARIO):
1. **Liquidation:** estimated liquidation price and distance %, using the margin-tier and liquidation formulas from the `strike-calculations` skill. **Validation:** for every existing position, Apex's computed liquidation price must be within 1% of the `liquidation_price` Strike returns; add this as an integration check and report mismatches instead of hiding them.
2. **Fees:** taker/maker rate from `/v2/fee-tiers` for the account's tier (or the base tier if unknown, labeled), open and close cost.
3. **Slippage:** walk `/v2/depth` levels for the order size; report average fill, slippage bps and "insufficient depth" if the book can't fill it.
4. **Funding cost:** current rate × notional per hour and per 24 h, labeled estimate (§4.8).
5. **Portfolio impact:** before/after total notional, effective leverage, concentration % and margin utilization, from `/v2/account` and `/v2/positions`.
6. **Stress:** PnL and liquidation status at adverse moves of 2%, 5%, 8% and custom.
7. **Risk/reward:** given SL/TP, loss and gain in USD and ratio.
8. **Weekend exposure:** underlying session state, hours until next open, gap-risk score (§6.6).
9. **Policy verdict:** referee output plus alternative.

### 6.6 Weekend Shield
- **Gap-risk score** per position:
  - `d` = liquidation distance = |mark − liq| / mark.
  - Historical closed-window returns: from `/v2/klines` (`1h`, `priceType=mark`, as much history as exists, ≤ 1500 rows per call, paginated), compute returns between each underlying close and the next open using the session map. If at least 8 samples exist, use the empirical distribution. Otherwise use a modeled one: σ_h from weekday 1h log-returns × √(closed hours), labeled `MODELED`.
  - `p_gap` = probability an adverse closed-window move ≥ `d` (empirical frequency, or normal tail for MODELED).
  - Bands: `LOW` < 5%, `MEDIUM` 5–20%, `HIGH` > 20%. Thresholds live in config.
  - Show sample count and method next to every score.
- **Flags:** `STALE_MARK` (§4.9), `THIN_BOOK` (depth within ±1% of mark below a config threshold, e.g. $10k), `UNDERLYING_UNKNOWN`.
- **Proposals:** for MEDIUM/HIGH, propose (a) a protective reduce-only stop at a price that restores `minLiquidationDistancePct` without triggering immediately, and/or (b) a partial close fraction that brings `p_gap` under the LOW threshold, and/or (c) for isolated positions, an `isoMargin add` amount that restores the target distance. Each proposal goes through Circuit and the referee.
- **Fair-value band (P1):** for equity perps, regress weekday 1h returns on NAS100 (equity) or SP500 returns; implied price = last mark at underlying close × (1 + β × index-perp return since close); band = ± 2 × residual σ × √hours. Label `ESTIMATE`, and show β, R² and sample count. If R² < 0.2, show "no reliable band".

### 6.7 Credit Line Copilot (P1) — exact doc formulas
Source: `https://docs.strikefinance.org/perpetuals/vaults/borrow-and-earn.md`. Inputs: `q` (collateral units), `P` (live collateral price), `s` (encumbered SLP shares), `S` (live SLP share price), `D` (debt USD). Per-asset `M`, `X`, `d` come from `/v2/credit/settings`; `Y = 0.20`, `F = 0.50`, `r = 0.05` from config.
- `C = q·P`, `V = s·S`, `c = C/D`, `v = V/D`
- `Φ(v) = (1 − v)/Y` if `v ≤ 1`, else `1 − v`
- `J = (1 − c)/X + Φ(v)`
- Active iff `J < 1` **and** `c > F`. Recovery iff `J ≥ 1` **or** `c ≤ F` (equality starts recovery).
- Joint health = `100·(2 − J)`, floor health = `100·c/F`, credit health = `max(0, min(joint, floor))` — score points, not percentages.
- Completion targets: `J* = (1 − r/X)/(1 − r)`, `F* = F/(1 − r)`.
- Admission: `D_after ≤ M·C_after`.
- Recovery boundary collateral price, for given `V` and `D`: solve `J = 1` and `c = F` for `P`; take the higher of the two prices (whichever binds first).
- Fix amounts: (a) cash repay `R` (reduces `D`; `C` and `V` unchanged) and (b) extra collateral `Δq` (raises `C`), each the minimum that reaches `J ≤ J*` **and** `c ≥ F*`. Solve by bisection with decimal.js; return an amount rounded **up** to cent / asset precision.
- Heatmap: a grid of collateral price change (0 to −50%) × SLP drawdown (0 to −30%) → health score per cell, with the recovery cells marked.
- Debt-remainder lock (display only): `C_lock = max(D_r/((1 − d)(1 − X)), F·D_r, D_r/M)`.
- **Mandatory unit tests (from the doc's own worked examples):**
  - `D = 400, X = 0.30, Y = 0.20, F = 0.50`:
    - `C = 400, V = 400` → `J = 0`, health `200.00`
    - `C = 280, V = 400` → `J = 1`, health `100.00`
    - `C = 400, V = 320` → `J = 1`
    - `C = 340, V = 360` → `J = 1`
    - `C = 250, V = 500` → `J = 1`
    - `C = 200, V = 800` → `J = 2/3`, floor binds, health `100.00`
  - 800 ADA, `D = 400`, `V = 400` → boundary price `$0.35`. With `V = 360` → `$0.425`.
  - ADA `J* = 50/57 ≈ 0.877193`, `F* = 10/19 ≈ 0.526316`; health thresholds ≈ `112.28` joint and `105.26` floor.
  - `C_lock` with `D_r = 40, d = 0.05, X = 0.30, F = 0.50, M = 1.00` → `60.15037594…`; at `$0.50` that is `120.300752` ADA (rounded up to 6 decimals).
  - Conversion price at `P = 0.50, d = 0.05` → `0.475`.

### 6.8 Mandate Vault (P2, PAPER)
- `config/mandate.json` is published in the repo and in the dashboard: max leverage, max drawdown, allowed symbols, max position, max exposure, actions per day, weekend rules, emergency rule (flatten all if drawdown > X).
- Signal: if the underlying is closed and the fair-value band is reliable, and |mark − implied| > 1.5 × band half-width, propose a reversion trade toward the implied price, closed before the next underlying open.
- Every candidate passes Circuit plus the referee (mandate as policy). PAPER fills only. Each decision is logged with inputs, reasoning text (template-generated, not LLM), checks and outcome.
- Show paper equity, drawdown and the decision list. If Maris later provides a real `VAULT_ID`, reads (`/v2/positions?vault_id=`) may show real vault state, labeled LIVE. Live vault trading needs a separate explicit approval.

### 6.9 Decision log
- Append-only JSONL at `logs/decisions.jsonl`. Entry: `{seq, ts, type, mode, payload, prevHash, hash, sig}`.
- `hash = sha256(prevHash + canonicalJSON(entry without hash/sig))`; `sig = ed25519(LOG_SIGNING_KEY, hash)`. Use a **separate** key from the trading key, generated on first run if absent, stored in `.env` / `keys/` (gitignored).
- `verify_log` recomputes the chain and checks every signature. Include a test that tampers with one line and expects verification to fail.

---

## 7. MCP server

- Package `@modelcontextprotocol/sdk` (TypeScript). **Read its current README first.** Transport: stdio (P0); streamable HTTP (P1).
- Tool names are snake_case. Inputs use zod schemas. Every output includes `mode` and per-number `label` where relevant. Outputs are concise JSON plus a one-paragraph plain-English summary.
- Tool descriptions must say that numbers are estimates and that Apex does not give financial advice.

| Tool | Purpose | Writes? |
|---|---|---|
| `list_markets` | All markets with class, perp status, underlying session, mark, funding, open interest, 24h volume. Filters: class, openOnly | no |
| `get_market` | One market: prices, funding, OI, depth summary, session, flags | no |
| `get_account_summary` | Balances, margin, leverage settings | no |
| `get_positions` | Positions with liquidation distance and gap-risk band | no |
| `get_order_history` | Recent orders/fills | no |
| `simulate_trade` | Circuit full report plus referee verdict and alternative | no |
| `stress_test_position` | Existing position at custom moves | no |
| `weekend_risk_report` | Every position: session, `p_gap`, band, flags, suggested protections | no |
| `get_fair_value` (P1) | Band, β, R², samples | no |
| `credit_line_health` (P1) | Health, J, c, v, boundary price, fix amounts (user-entered line values) | no |
| `credit_stress_grid` (P1) | Heatmap data | no |
| `propose_protection` | Builds a stop / partial close / iso-margin proposal for a position | no (stores proposal) |
| `propose_trade` | Builds an open-trade proposal (Circuit + referee) | no (stores proposal) |
| `execute_proposal` | Executes a stored proposal after `confirm: true`; PAPER or LIVE per §6.4 | **yes** |
| `cancel_order` | Proposal + confirm flow for a cancel | **yes** |
| `get_policy` / `set_policy` | Read/update the risk policy (validated) | config only |
| `get_decision_log` / `verify_log` | Read entries; verify the chain | no |
| `vault_status` / `vault_decisions` (P2) | Mandate, paper equity, decisions | no |

- Claude Desktop config example goes in the README (`command: node`, `args: [<abs path>/packages/mcp/dist/index.js]`, env from `.env`).
- MCP tests: start the server in-process, list tools, call `list_markets` against the saved fixtures, and check that every tool schema validates.

---

## 8. Stack and repo layout

- **Node 20+**, TypeScript strict, **pnpm** workspaces (npm workspaces acceptable if pnpm is missing — ask first).
- Dependencies (only these unless Maris approves more): `@noble/ed25519@^2`, `@noble/hashes`, `decimal.js`, `zod`, `@modelcontextprotocol/sdk`, `luxon`, `ws` (only if user-stream reconciliation is needed), `dotenv`; dev: `typescript`, `tsx`, `vitest`. Dashboard: `vite`, `react`, `react-dom`; for charts, plain SVG or one small lib (ask first).
- Layout:
```
apex/
  CLAUDE.md                 # this file
  VERIFICATION.md           # verified vs assumed, live-vs-spec differences
  README.md                 # submission docs
  docs/
    IMPLEMENTATION_STATUS.md  # per-phase status with evidence (§13)
    BLOCKERS.md               # open and resolved blockers (§13)
  .env.example
  config/                   # policy.default.json, mandate.json, sessions.ts, credit.ts, thresholds.ts
  fixtures/live/            # real responses captured in Phase 0 (no secrets)
  packages/
    core/                   # strike client, signing, types, registry, referee, circuit, shield, credit, log, execution
      src/ ... tests/ ...
    mcp/                    # MCP server (stdio; http in P1)
    api/                    # tiny local HTTP API for the dashboard (node:http), reuses core
    web/                    # Vite + React dashboard
  scripts/                  # phase0-verify.ts, smoke-live.ts (read-only), demo-seed.ts (paper)
  logs/                     # gitignored
```
- Env (`.env.example`):
```
STRIKE_ENV=mainnet            # mainnet | testnet
STRIKE_API_PUBLIC_KEY=
STRIKE_API_PRIVATE_KEY=
APEX_MODE=paper               # paper | live
LOG_SIGNING_KEY=              # generated on first run if empty
APEX_API_PORT=8787
VAULT_ID=                     # optional, read-only display
```

---

## 9. Phases, gates and time budget

Times are targets in Lagos time (UTC+1), starting about Thu 20:00. Each phase ends with: tests green (show output), `VERIFICATION.md`, `docs/IMPLEMENTATION_STATUS.md` and `docs/BLOCKERS.md` updated, commit, and a 3–5 line status note to Maris. Do not start the next phase until the gate passes.

**Phase 0 — Plan and verify (≈ 45 min).**
- Restate the plan in ≤ 15 bullets and **wait for Maris's "go"**.
- Clone `strike-finance-skills` into `ref/`. Write `scripts/phase0-verify.ts` that calls, on the selected env: `exchangeInfo`, `marketStats`, `markPrice`, `depth` (BTC-USD and NVDA-USD), `klines` (NVDA-USD 1h, mark), `fee-tiers`, `credit/settings`, `credit/collateral-assets`, `vaults?type=protocol`. Save the responses to `fixtures/live/`.
- With keys present: `GET /v2/account` and `GET /v2/positions` (read-only).
- Create `docs/IMPLEMENTATION_STATUS.md` and `docs/BLOCKERS.md` (§13).
- Record in `VERIFICATION.md`: casing of side/type, filter field names, what `fundingRate` means, whether testnet has TradFi markets, fee-tier shape, credit fields, and any mismatch with this file.
- **Gate:** every call above succeeds or its failure is documented, and Maris acknowledges the findings.

**Phase 1 — Core client (≈ 1.5 h).** Signing (test vector: a fixed key, nonce and timestamp produce a stable signature and message string), REST wrapper with typed errors, market-data and account modules, registry merge, session map. **Gate:** unit tests pass; read-only smoke script prints live markets and (with keys) positions.

**Phase 2 — Referee, policy, log (≈ 1.5 h).** All rules R1–R12 with tests (approve and block cases each), alternative generator, decision log plus verify, and the tamper test. **Gate:** 100% of referee rules covered by tests.

**Phase 3 — Circuit (≈ 2 h).** Liquidation (with the validation against real positions), fees, depth walk, funding, portfolio impact, stress, risk/reward. **Gate:** tests pass on fixtures; live run on NVDA-USD prints a full report with labels; the liquidation check reports matches or mismatches.

**Phase 4 — Weekend Shield (≈ 1.5 h).** Session states, closed-window returns, `p_gap`, flags, proposals. **Gate:** report for all TradFi markets with method and sample counts shown; unknown sessions marked.

**Phase 5 — MCP server (≈ 1.5 h).** P0 tools, MCP tests, Claude Desktop config. **Gate:** Maris connects it in Claude Desktop and runs `list_markets`, `simulate_trade` and `weekend_risk_report`.

**Phase 6 — Execution (≈ 1.5 h).** Proposals, PAPER execution, LIVE path plus reconciliation. **Gate:** PAPER end-to-end demo works. LIVE: **stop and ask** Maris; with her approval, run one tiny protective stop (and cancel it) on a small position she opens herself, and show Strike's reconciled status.

**Phase 7 — Dashboard (≈ 2 h).** Pages: Markets Radar (class filter, session chips, flags), Circuit (form → report), Positions (risk bands, proposals, confirm button that goes through the same proposal flow), Decision Log (with verify button). Mode badge always visible: LIVE / PAPER / SCENARIO. Must look good at 1440 px and remain usable at 390 px. **Gate:** screenshots attached to the status note.

**Phase 8 — Credit Line Copilot (P1, ≈ 1.5 h).** Formulas plus all doc tests, MCP tools and a dashboard page with the heatmap. **Gate:** every doc example test passes exactly.

**Phase 9 — Fair-value band (P1) and Mandate Vault paper (P2) (≈ 1.5 h total).** Only if Phases 0–8 are green before ~09:00 Fri Lagos time; otherwise skip and list them in the Roadmap.

**Phase 10 — Docs and submission (≈ 1.5 h, must start no later than 12:00 Fri Lagos).** README (§10), demo script, final test run, tag `v1.0.0`. Stop all feature work at 13:30 Lagos.

**Cut order if behind (drop from the bottom first):** Mandate Vault → fair-value band → HTTP transport → Credit Copilot heatmap (keep the numbers) → dashboard polish. **Never cut:** the referee, labels, fail-closed behavior, the decision log, or tests.

---

## 10. README (submission documentation) must contain
1. What Apex is (the one-liner) and the problem (weekend gaps, hidden pre-trade risk, complex credit lines, unsafe AI automation).
2. Feature list, each marked **Working**, **Paper**, or **Roadmap** — truthfully.
3. **How Apex uses Strike:** a table of every endpoint actually called, and for what.
4. Architecture diagram (Mermaid): Core → MCP / API → Web; Strike REST/WS.
5. Safety model: trade-only key, referee rules list, human confirmation, fail-closed behavior, PAPER default, decision log. Plainly stated limit: "Apex's limits are enforced by Strike key permissions and the Apex referee, not by an on-chain contract. Estimates are not guarantees and not financial advice."
6. Setup: requirements, `.env`, install, run the MCP server, connect Claude Desktop, run the dashboard.
7. Demo script (5 scenes, below) and the link to the demo video.
8. Business model: builder-code fees (roadmap via builder connect), vault leader fees, premium monitoring.
9. Roadmap.
10. `VERIFICATION.md` summary: what was verified live and what is assumed.

**Demo scenes (must match what actually works):**
1. Claude: "What's my weekend risk across Strike?" → `weekend_risk_report`.
2. Claude: "Simulate a $1,000 NVDA long at 10x." → Circuit blocks it (R1/R2/R5) and offers a compliant alternative with numbers.
3. Claude: "Protect my position." → proposal → confirm → execution (LIVE tiny, or PAPER, labeled) → log entry shown in the dashboard.
4. Dashboard: Credit Line heatmap and fix amount (if P1 done).
5. Mandate Vault paper decision (if done); otherwise show the referee rules and log verification.
Every scene states on screen whether it is LIVE, PAPER or SCENARIO.

---

## 11. Definition of done
- `pnpm test` passes (show output). There are no skipped tests.
- `pnpm build` passes with TypeScript strict and no `any` in core money paths.
- The read-only live smoke script runs against mainnet without errors.
- The MCP server works in Claude Desktop, with the tools from §7 that are in scope.
- The dashboard runs locally and shows live markets.
- At least one LIVE protective action has been executed and reconciled with Maris's approval, **or** the README clearly states execution was demonstrated in PAPER mode.
- README and `VERIFICATION.md` are complete and truthful; no secrets are in the git history (`git log -p | grep -i private` returns nothing sensitive).
- Repo pushed to `github.com/Stella112/apex` (or the name Maris chooses), public before submission.

---

## 12. Communication format (every status message to Maris)
```
PHASE n — <name> — <PASS | BLOCKED | IN PROGRESS>
Done: <what works, with command used>
Evidence: <test summary line / key output>
Verified vs assumed: <new items>
Next: <next step>
Need from Maris: <decision or "nothing">
```
Keep messages short. Put long output in files and point to them.

---

## 13. Progress documents and resuming work

### 13.1 `docs/IMPLEMENTATION_STATUS.md`
Create it in Phase 0 if it does not exist. One row per phase from §9, plus one row per scope item from §5:
```
| Phase / item | Tier | Status | Evidence | Updated (UTC) |
|---|---|---|---|---|
| Phase 1 — Core client | P0 | PASS | `pnpm test` 42/42; smoke-live printed 33 markets | 2026-10-22 21:40 |
```
- Status is one of `NOT STARTED`, `IN PROGRESS`, `PASS`, `BLOCKED`, `CUT` (cut only via the §9 cut order, with Maris told).
- `PASS` requires evidence you produced in the current session: a test summary line, a command and its key output, or a screenshot path. "Reported earlier" is not evidence.
- Add a "Known gaps" list under the table for anything that works partly.

### 13.2 `docs/BLOCKERS.md`
Create it in Phase 0 if it does not exist.
```
## Open
- [B3] <short title> — opened <UTC> — phase <n>
  - What happened: <facts, error text>
  - Tried: <attempts>
  - Needed to clear: <decision / key / endpoint / approval from Maris>
## Resolved
- [B1] <title> — resolved <UTC> — <how>
```
- Every stop-and-ask trigger (§2.3) that occurs gets a blocker entry.
- Never delete entries; move them to Resolved.

### 13.3 Resume protocol (any new session, or after an interruption)
1. Read this file fully, then `docs/IMPLEMENTATION_STATUS.md`, `docs/BLOCKERS.md` and `VERIFICATION.md` (create any that are missing, per §13.1–13.2).
2. Establish real state: run `git status`, `git log --oneline -20`, `pnpm install`, `pnpm build`, `pnpm test`, and show the summary output.
3. Re-check every row marked `PASS`: if its evidence cannot be reproduced now (tests fail, build breaks, code missing), set it back to `IN PROGRESS` and note why. Do not trust earlier reports without evidence.
4. Resume at the first phase whose gate is not passed. Keep every pillar at the tier §5 assigns it.
5. Continue implementing, testing and fixing without waiting for planning approval, **except** at the §2.3 stop-and-ask triggers, which always apply. (Phase 0's "wait for go" applies only to a brand-new project.)
6. Do not restart, redesign, or remove working functionality. The only allowed reductions are the §9 cut order, applied when behind schedule and only after telling Maris.
7. After each gate: update the three progress documents, commit, and send a §12 status note.
