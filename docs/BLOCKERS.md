# Blockers

## Open
- [B2] No API wallet keys yet — opened 2026-10-22 19:30 UTC — phase 0
  - What happened: `.env` has no `STRIKE_API_PUBLIC_KEY` / `STRIKE_API_PRIVATE_KEY`; `/v2/account` and `/v2/positions` not verified.
  - Needed to clear: Maris registers a key at https://app.strikefinance.org/api-keys and puts both values directly into `apex/.env` (not in chat). Phase 1 smoke used the SLP vault's public positions instead. Still needed for own-account reads, Phase 3 validation on Maris's positions, and Phase 6 LIVE.
- [B3] R4 concentration denominator ambiguous — opened 2026-10-22 19:46 UTC — phase 2
  - What happened: R4 "resulting concentration ≤ 40%" read literally as symbol notional ÷ resulting portfolio notional makes any first trade (or any single-market book) 100% → always BLOCK, and the alternative generator can't fix it (demo scene 2 would show no alternative).
  - Tried: implemented denominator = max(resulting portfolio notional, maxPortfolioNotionalUsd) — "share of the allowed $2,000 book". A $500 first trade = 25% (pass); $1,000 = 50% (fail). One function: packages/core/src/referee.ts concentrationPct().
  - Needed to clear: Maris picks (a) keep this, (b) literal ratio, or (c) literal ratio but only once the portfolio holds ≥ 2 markets.

## Resolved
- [B1] marketStats labels 9 stock/index perps as "Crypto" — resolved 2026-10-22 19:35 UTC — Maris: a cited config/sessions.ts entry overrides the API category, with a CATEGORY_MISMATCH note (implemented in packages/core/src/registry.ts, tested).
