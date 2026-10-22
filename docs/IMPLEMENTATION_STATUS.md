# Implementation status

| Phase / item | Tier | Status | Evidence | Updated (UTC) |
|---|---|---|---|---|
| Phase 0 — Plan and verify | P0 | PASS | `pnpm phase0` 13/13 OK on mainnet; Maris acked findings 2026-10-22 | 2026-10-22 19:40 |
| Phase 1 — Core client | P0 | PASS | `pnpm test` 4 files, 54/54 passed; `pnpm build` OK; `pnpm smoke` printed 33 live markets + 33 SLP vault positions (public read, no keys) | 2026-10-22 19:42 |
| Phase 2 — Referee, policy, log | P0 | IN PROGRESS | `pnpm test` 6 files, 100/100 passed; R1–R12 each have approve + block tests (referee.test.ts); alternative generator + log tamper tests pass. Gate held on B3 (R4 denominator) | 2026-10-22 19:46 |
| Phase 3 — Circuit | P0 | NOT STARTED | | |
| Phase 4 — Weekend Shield | P0 | NOT STARTED | | |
| Phase 5 — MCP server | P0 | NOT STARTED | | |
| Phase 6 — Execution | P0 | NOT STARTED | | |
| Phase 7 — Dashboard | P0 | NOT STARTED | | |
| Phase 8 — Credit Line Copilot | P1 | NOT STARTED | | |
| Phase 9 — Fair-value band + Mandate Vault | P1/P2 | NOT STARTED | | |
| Phase 10 — Docs and submission | P0 | NOT STARTED | | |
| 1. Apex Core | P0 | IN PROGRESS | client, signing, registry, sessions (Phase 1); referee, policy, signed log (Phase 2, pending B3) | 2026-10-22 19:46 |
| 2. Circuit | P0 | NOT STARTED | | |
| 3. Weekend Shield | P0 | NOT STARTED | | |
| 4. Protected execution | P0 | NOT STARTED | | |
| 5. MCP server (stdio) | P0 | NOT STARTED | | |
| 6. Dashboard | P0 | NOT STARTED | | |
| 7. Credit Line Copilot | P1 | NOT STARTED | | |
| 8. Fair-value bands | P1 | NOT STARTED | | |
| 9. Streamable HTTP transport | P1 | NOT STARTED | | |
| 10. Mandate Vault (paper) | P2 | NOT STARTED | | |
| 11. Builder connect, alerts, anchoring, hosting | P2 | NOT STARTED | Roadmap only | |

## Known gaps
- R4 concentration uses denominator max(resulting portfolio, maxPortfolioNotionalUsd) pending Maris decision (B3).
- Cancels are checked by R12 only; reductions skip R1–R6 and R9 (CLAUDE.md §6.3 lists only R7, R8, R10, R11, R12 for reductions).
- Stop orders are checked against both LOT_SIZE and MARKET_LOT_SIZE (which one the engine applies to triggered stops is undocumented).
- Signed (own-account) reads not yet exercised live — no API wallet keys in `.env` (B2). Shapes verified via the public vault_id selector; signing verified by RFC 8032 vector + round-trip tests.
- CME holidays not modeled (commodity sessions labeled assumed).
