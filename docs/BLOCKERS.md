# Blockers

## Open
- [B2] No API wallet keys yet — opened 2026-10-22 19:30 UTC — phase 0
  - What happened: `.env` has no `STRIKE_API_PUBLIC_KEY` / `STRIKE_API_PRIVATE_KEY`; `/v2/account` and `/v2/positions` not verified.
  - Needed to clear: Maris registers a key at https://app.strikefinance.org/api-keys and puts both values directly into `apex/.env` (not in chat). Phase 1 smoke used the SLP vault's public positions instead. Still needed for own-account reads, Phase 3 validation on Maris's positions, and Phase 6 LIVE.

## Resolved
- [B1] marketStats labels 9 stock/index perps as "Crypto" — resolved 2026-10-22 19:35 UTC — Maris: a cited config/sessions.ts entry overrides the API category, with a CATEGORY_MISMATCH note (implemented in packages/core/src/registry.ts, tested).
