# Blockers

## Open
- [B1] marketStats labels 9 stock/index perps as "Crypto" — opened 2026-10-22 19:30 UTC — phase 0
  - What happened: `/price/v2/marketStats` returns `category:"Crypto", subCategory:""` for AAOI, COIN, CRCL, DRAM, GOOGL, MINIMAX, SP500, UNITREE, ZHIPU. CLAUDE.md §6.1 says class = `crypto` if `category == "Crypto"`, which would give these markets no underlying-session risk.
  - Tried: checked `exchangeInfo` (no category field; `underlyingType:"COIN"` for all symbols, incl. NVDA, so not useful).
  - Needed to clear: Maris decides the classification rule. Proposed: an explicit entry in `config/sessions.ts` (with a cited source) overrides the API category, and Apex shows a `CATEGORY_MISMATCH` note; symbols without a cited entry fall back to the API category.
- [B2] No API wallet keys yet — opened 2026-10-22 19:30 UTC — phase 0
  - What happened: `.env` has no `STRIKE_API_PUBLIC_KEY` / `STRIKE_API_PRIVATE_KEY`; `/v2/account` and `/v2/positions` not verified.
  - Needed to clear: Maris registers a key at https://app.strikefinance.org/api-keys and puts both values directly into `apex/.env` (not in chat). Needed by Phase 1 smoke (positions) and Phase 3 liquidation validation.

## Resolved
