# Implementation status

| Phase / item | Tier | Status | Evidence | Updated (UTC) |
|---|---|---|---|---|
| Phase 0 — Plan and verify | P0 | PASS | `pnpm phase0` 13/13 OK on mainnet; Maris acked findings 2026-10-22 | 2026-10-22 19:40 |
| Phase 1 — Core client | P0 | PASS | `pnpm test` 4 files, 54/54 passed; `pnpm build` OK; `pnpm smoke` printed 33 live markets + 33 SLP vault positions (public read, no keys) | 2026-10-22 19:42 |
| Phase 2 — Referee, policy, log | P0 | NOT STARTED | | |
| Phase 3 — Circuit | P0 | NOT STARTED | | |
| Phase 4 — Weekend Shield | P0 | NOT STARTED | | |
| Phase 5 — MCP server | P0 | NOT STARTED | | |
| Phase 6 — Execution | P0 | NOT STARTED | | |
| Phase 7 — Dashboard | P0 | NOT STARTED | | |
| Phase 8 — Credit Line Copilot | P1 | NOT STARTED | | |
| Phase 9 — Fair-value band + Mandate Vault | P1/P2 | NOT STARTED | | |
| Phase 10 — Docs and submission | P0 | NOT STARTED | | |
| 1. Apex Core | P0 | IN PROGRESS | client, signing, registry, sessions done (Phase 1); referee/policy/log pending (Phase 2) | 2026-10-22 19:42 |
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
- Signed (own-account) reads not yet exercised live — no API wallet keys in `.env` (B2). Shapes verified via the public vault_id selector; signing verified by RFC 8032 vector + round-trip tests.
- CME holidays not modeled (commodity sessions labeled assumed).
