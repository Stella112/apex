# Implementation status

| Phase / item | Tier | Status | Evidence | Updated (UTC) |
|---|---|---|---|---|
| Phase 0 — Plan and verify | P0 | IN PROGRESS | `pnpm phase0` → "13/13 calls OK on mainnet"; fixtures in `fixtures/live/`; awaiting Maris ack + B1 decision | 2026-10-22 19:32 |
| Phase 1 — Core client | P0 | NOT STARTED | | |
| Phase 2 — Referee, policy, log | P0 | NOT STARTED | | |
| Phase 3 — Circuit | P0 | NOT STARTED | | |
| Phase 4 — Weekend Shield | P0 | NOT STARTED | | |
| Phase 5 — MCP server | P0 | NOT STARTED | | |
| Phase 6 — Execution | P0 | NOT STARTED | | |
| Phase 7 — Dashboard | P0 | NOT STARTED | | |
| Phase 8 — Credit Line Copilot | P1 | NOT STARTED | | |
| Phase 9 — Fair-value band + Mandate Vault | P1/P2 | NOT STARTED | | |
| Phase 10 — Docs and submission | P0 | NOT STARTED | | |
| 1. Apex Core | P0 | NOT STARTED | | |
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
- Authenticated reads (`/v2/account`, `/v2/positions`) not yet verified — no API wallet keys in `.env`.
