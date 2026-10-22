# Implementation status

| Phase / item | Tier | Status | Evidence | Updated (UTC) |
|---|---|---|---|---|
| Phase 0 — Plan and verify | P0 | PASS | `pnpm phase0` 13/13 OK on mainnet; Maris acked findings 2026-10-22 | 2026-10-22 19:40 |
| Phase 1 — Core client | P0 | PASS | `pnpm test` 4 files, 54/54 passed; `pnpm build` OK; `pnpm smoke` printed 33 live markets + 33 SLP vault positions (public read, no keys) | 2026-10-22 19:42 |
| Phase 2 — Referee, policy, log | P0 | PASS | `pnpm test` 6 files, 100/100 passed; R1–R12 approve + block tests; alternative + log tamper tests | 2026-10-22 19:55 |
| Phase 3 — Circuit | P0 | PASS | `pnpm test` 7 files 114/114; `pnpm circuit` live NVDA report with labels (docs/evidence/phase3-circuit-live-NVDA.txt); live liquidation check 33/33 within 1% (SLP vault, public) | 2026-10-22 19:57 |
| Phase 4 — Weekend Shield | P0 | PASS | `pnpm test` 8 files 129/129; `pnpm weekend` live: 20 TradFi markets with method + samples (13 EMPIRICAL, 7 MODELED/UNDERLYING_UNKNOWN), 33 SLP positions banded (docs/evidence/phase4-weekend-live.txt) | 2026-10-22 20:08 |
| Phase 5 — MCP server | P0 | IN PROGRESS | 16 tools; `pnpm test` 9 files 138/138 (in-process MCP tests); stdio smoke vs live mainnet: list_markets, simulate_trade, weekend_risk_report OK in 22 s (docs/evidence/phase5-mcp-stdio-smoke.txt). Gate needs Maris to connect Claude Desktop | 2026-10-22 20:16 |
| Phase 6 — Execution | P0 | IN PROGRESS | PAPER PASS: `pnpm demo:seed` live prices → 2 paper fills + resting paper stop via propose→referee→confirm→execute, verify_log ok (docs/evidence/phase6-paper-e2e.txt); LIVE path tested against mocked Strike (execution.test.ts). LIVE run BLOCKED on B2 (keys) + Maris approval | 2026-10-22 20:20 |
| Phase 7 — Dashboard | P0 | PASS | `pnpm dashboard` → Markets radar, Circuit, Positions (Protect → Confirm PAPER → log #18), Decision log (verify ✓ 19 entries); screenshots docs/evidence/dashboard-*-1440.jpg, dashboard-radar-390.jpg (scrollWidth 390 = viewport) | 2026-10-22 20:30 |
| Phase 8 — Credit Line Copilot | P1 | PASS | credit.test.ts 16/16 — every doc example exact (J, health 200/100, $0.35/$0.425 boundary, J*=50/57, F*=10/19, 112.28/105.26, C_lock 60.15037594 → 120.300752 ADA, 0.475); MCP credit_line_health + credit_stress_grid; dashboard Credit page with heatmap on live ADA/SLP prices (docs/evidence/dashboard-credit-1440.jpg); `pnpm test` 162/162 | 2026-10-22 20:36 |
| Phase 9 — Fair-value band + Mandate Vault | P1/P2 | PASS | fair value live for 17 equity/index perps (docs/evidence/phase9-fairvalue-live.txt); Streamable HTTP MCP smoke (19 tools, foreign Host → 403); `pnpm vault:tick` live (7 logged decisions, no signal) + signal-path test; dashboard Vault page; `pnpm test` 13 files 175/175 | 2026-10-22 20:42 |
| Phase 10 — Docs and submission | P0 | IN PROGRESS | README (features with true status, endpoint table, Mermaid architecture, safety model, setup, demo, business model, roadmap, verification summary), docs/DEMO.md, LICENSE; final `pnpm build` OK, `pnpm test` 13 files 175/175 (0 skipped), `pnpm smoke` OK, secrets check clean; tag v1.0.0. Pending Maris: demo video, GitHub push/public, Claude Desktop check, optional LIVE run | 2026-10-22 20:45 |
| 1. Apex Core | P0 | PASS | client, signing, registry, sessions, referee, policy, signed log; all tested | 2026-10-22 20:45 |
| 2. Circuit | P0 | PASS | liquidation, fees, depth walk, funding, portfolio impact, stress, R/R, verdict + alternative report | 2026-10-22 19:57 |
| 3. Weekend Shield | P0 | PASS | sessions, closed-window returns (paginated 1h mark klines), p_gap, bands, STALE_MARK/THIN_BOOK/UNDERLYING_UNKNOWN, stop/partial-close/isoMargin proposals through the referee | 2026-10-22 20:08 |
| 4. Protected execution | P0 | IN PROGRESS | PAPER working; LIVE stop/partial close/isoMargin/cancel code + reconcile, mocked-tested; not yet run live | 2026-10-22 20:20 |
| 5. MCP server (stdio) | P0 | IN PROGRESS | works over stdio (smoke); Claude Desktop check by Maris pending | 2026-10-22 20:16 |
| 6. Dashboard | P0 | PASS | Overview page (live liquidation proof 33/33, live Circuit verdict + alternative, weekend gap bars + sparklines, log integrity); all 7 pages load live data with no console errors at 1440 px; 390 px no horizontal overflow (docs/evidence/dashboard-overview-1440.jpg); `pnpm test` 14 files 180/180 | 2026-10-22 21:00 |
| 7. Credit Line Copilot | P1 | PASS | health, recovery boundary, fix amounts, heatmap; user-entered line values, live prices | 2026-10-22 20:36 |
| 8. Fair-value bands | P1 | PASS | β/R²/samples shown; R² < 0.2 → no reliable band | 2026-10-22 20:42 |
| 9. Streamable HTTP transport | P1 | PASS | `pnpm mcp:http` 127.0.0.1:8788/mcp, stateless, DNS-rebinding protection | 2026-10-22 20:42 |
| 10. Mandate Vault (paper) | P2 | PASS (PAPER) | published config/mandate.json, reversion signal, Circuit + referee per candidate, paper fills, template reasoning in the signed log, vault_status/vault_decisions | 2026-10-22 20:42 |
| 11. Builder connect, alerts, anchoring, hosting | P2 | NOT STARTED | Roadmap only | |

## Known gaps
- LIVE opens are refused by design (P0 LIVE scope = protective stop + partial close; isoMargin add and cancel also wired).
- PAPER limit orders are not simulated (market only); paper stops trigger when Apex next reads the paper ledger.
- Circuit without an account models the trade as isolated-equivalent (margin = notional/leverage), labeled.
- Fees use base tier 0; the account's own tier (/v2/portfolio fee_tier) is not read.
- Circuit shows p_gap for the simulated trade (Weekend Shield distribution at its liquidation distance).
- R4 concentration denominator = max(resulting portfolio, maxPortfolioNotionalUsd) (B3, decided).
- Cancels are checked by R12 only; reductions skip R1–R6 and R9 (CLAUDE.md §6.3 lists only R7, R8, R10, R11, R12 for reductions).
- Stop orders are checked against both LOT_SIZE and MARKET_LOT_SIZE (which one the engine applies to triggered stops is undocumented).
- Signed (own-account) reads not yet exercised live — no API wallet keys in `.env` (B2). Shapes verified via the public vault_id selector; signing verified by RFC 8032 vector + round-trip tests.
- CME holidays not modeled (commodity sessions labeled assumed).
