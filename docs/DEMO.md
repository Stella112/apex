# Apex demo script (≈ 4 minutes)

Before recording:

```bash
pnpm build
```

```bash
pnpm demo:seed
```

```bash
pnpm dashboard
```

Connect Claude Desktop to the stdio server (README → *Connect Claude Desktop*). Keep the dashboard open at <http://127.0.0.1:8787>. The mode badge (top right) reads **PAPER** unless `APEX_MODE=live` and keys are set.

## Scene 1 — Weekend risk (Claude, LIVE data, PAPER positions)

> "What's my weekend risk across Strike? Use my paper account."

Claude calls `weekend_risk_report` (`source: paper`). Point out:
- Every stock/index/commodity perp with its underlying session (closed/unknown) and hours to the next open.
- **EMPIRICAL** stats with sample counts, from Strike's own 1h mark history (NVDA ≈ 97 close→open windows), or **MODELED** for unknown sessions (SKHYNIX…), flagged `UNDERLYING_UNKNOWN`.
- Per position: liquidation distance, `p_gap`, band.

Optional: "And the SLP vault?" → `source: vault` (public, read-only, LIVE).

## Scene 2 — Circuit blocks a bad trade (Claude, SCENARIO)

> "Simulate a $1,000 NVDA long at 10x."

Claude calls `simulate_trade`. Show:
- Liquidation ≈ 9 % away (Strike margin-tier formula), fees, slippage in bps, stress at 2/5/8 %.
- **Referee: BLOCK**: R1 (10x > 3x while the US market is closed), R2 ($1,000 > $500), R4 (concentration), R5 (9 % < 15 %).
- **Compliant alternative:** ≈ 2.3 NVDA at 3x, with its own Circuit numbers, APPROVE.

Same thing in the dashboard → **Circuit** tab.

## Scene 3 — Protect a position (Claude → dashboard, PAPER)

> "Protect my NVDA position."

Claude calls `propose_protection`. A reduce-only sell stop is placed beyond the liquidation buffer, the referee approves, and it states plainly that a stop doesn't protect against a gap through it.

> "Yes, execute it."

Claude calls `execute_proposal` with `confirm: true` → `resting (PAPER simulated stop)` with a log number.

Dashboard → **Decision log**: the proposal and execution entries are at the top. Click **Verify chain & signatures** → ✓.

(LIVE variant, only with keys, `APEX_MODE=live` and Maris's explicit approval: the same flow sends one reduce-only `POST /v2/order`, then shows Strike's reconciled status, e.g. `untriggered (Strike)`.)

## Scene 4 — Credit Line Copilot (dashboard, LIVE prices + user-entered line)

Dashboard → **Credit**. Enter 800 ADA, debt $100, 86.4 SLP shares → **Check health**:
- health score and state, J, the recovery-boundary ADA price with its distance, fix amount;
- heatmap of collateral drop × SLP drawdown, with recovery cells in red.

Mention that every worked example from Strike's Borrow-and-Earn doc is a passing unit test.

## Scene 5 — Mandate Vault (dashboard, PAPER)

Dashboard → **Vault**: the published mandate, paper equity and drawdown, and **Run mandate check now**. Each symbol gets a logged decision with template reasoning ("No trade: mark 0.12 % from implied, inside ±0.92 %"). Entries are opened only when the mark leaves the fair-value band, always through Circuit + referee, and always flat before the open.

Close on the safety line: *Apex's limits are enforced by Strike key permissions and the Apex referee, not by an on-chain contract. Estimates are not guarantees and not financial advice.*
