# Blockers

## Open
- [B2] No API wallet keys yet — opened 2026-10-22 19:30 UTC — phase 0
  - What happened: `.env` has no `STRIKE_API_PUBLIC_KEY` / `STRIKE_API_PRIVATE_KEY`; `/v2/account` and `/v2/positions` not verified.
  - Needed to clear: Maris registers a key at https://app.strikefinance.org/api-keys and puts both values directly into `apex/.env` (not in chat). Phase 1 smoke used the SLP vault's public positions instead. Still needed for own-account reads, Phase 3 validation on Maris's positions, and Phase 6 LIVE.- [B4] Gates that need Maris — opened 2026-10-22 20:45 UTC — phases 5, 6, 10
  - Phase 5: connect Claude Desktop with docs/claude_desktop_config.example.json and run list_markets, simulate_trade, weekend_risk_report (stdio already verified with the SDK client).
  - Phase 6 LIVE: needs API keys (B2), APEX_MODE=live, a small position opened by Maris, and in-chat approval before one tiny protective stop + cancel.
  - Phase 10: record the demo video; approve pushing to github.com/Stella112/apex and making it public.

## Resolved
- [B3] R4 concentration denominator — resolved 2026-10-22 19:55 UTC — Maris delegated ("use the best option"); kept denominator = max(resulting portfolio, maxPortfolioNotionalUsd).
- [B1] marketStats labels 9 stock/index perps as "Crypto" — resolved 2026-10-22 19:35 UTC — Maris: a cited config/sessions.ts entry overrides the API category, with a CATEGORY_MISMATCH note (implemented in packages/core/src/registry.ts, tested).
