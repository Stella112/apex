import { useState } from "react";
import { type CreditGrid, type CreditHealth, api } from "./api";

function color(h: number, recovery: boolean): string {
  if (recovery) return "color-mix(in srgb, var(--danger) 55%, transparent)";
  if (h >= 150) return "color-mix(in srgb, var(--ok) 45%, transparent)";
  if (h >= 112.28) return "color-mix(in srgb, var(--ok) 22%, transparent)";
  return "color-mix(in srgb, var(--warn) 35%, transparent)";
}

export function Credit() {
  const [f, setF] = useState({ asset: "ADA", collateralUnits: "800", debtUsd: "100", encumberedShares: "86.4" });
  const [h, setH] = useState<CreditHealth | null>(null);
  const [g, setG] = useState<CreditGrid | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const run = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const [a, b] = await Promise.all([api.creditHealth(f), api.creditGrid(f)]);
      setH(a);
      setG(b);
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Credit Line Copilot <span className="badge ESTIMATE"><span className="dot" />ESTIMATE</span></h1>
      <p className="sub">Borrow-and-Earn health with the exact formulas from Strike's docs. Strike has no per-user credit-line endpoint, so you enter the line values; collateral and SLP share prices are read live.</p>
      <div className="grid cols-2">
        <form className="card stack" onSubmit={run}>
          <h2>Your line (user-entered)</h2>
          <label>Collateral asset<select value={f.asset} onChange={set("asset")}>{["ADA", "sUSDrf", "LP_SUNDAE_USDCx_USDM", "SCALED_AAVE_V3_ETH_aUSDC"].map((a) => <option key={a}>{a}</option>)}</select></label>
          <label>Pledged collateral units (q)<input inputMode="decimal" value={f.collateralUnits} onChange={set("collateralUnits")} /></label>
          <label>Debt, USD (D)<input inputMode="decimal" value={f.debtUsd} onChange={set("debtUsd")} /></label>
          <label>Encumbered SLP shares (s)<input inputMode="decimal" value={f.encumberedShares} onChange={set("encumberedShares")} /></label>
          <button className="btn" disabled={busy}>{busy ? "Reading live prices…" : "Check health"}</button>
          {err && <p className="err">{err}</p>}
          <p className="basis">Read-only. Apex never draws, repays or moves collateral.</p>
        </form>
        <div className="grid" style={{ gap: 16 }}>
          {!h && <div className="card muted">Enter your line values and check its health.</div>}
          {h && (
            <>
              {h.warnings.map((w) => <p key={w} className="err">{w}</p>)}
              <div className="grid cols-4">
                <div className="card kpi"><div className="k">Credit health</div><div className="v" style={{ color: h.health.state === "RECOVERY" ? "var(--danger)" : Number(h.health.credit) < 112.28 ? "var(--warn)" : "var(--ok)" }}>{h.health.credit}</div><div className="k">{h.health.state}</div></div>
                <div className="card kpi"><div className="k">Joint risk J</div><div className="v">{Number(h.values.J).toFixed(4)}</div><div className="k">recovery at ≥ 1</div></div>
                <div className="card kpi"><div className="k">Recovery at {h.inputs.asset} price</div><div className="v">${Number(h.recoveryBoundary.collateralPrice).toFixed(4)}</div><div className="k">{h.recoveryBoundary.binds} binds · {h.recoveryBoundary.distancePct}% below</div></div>
                <div className="card kpi"><div className="k">{h.inputs.asset} price <span className="lbl">LIVE</span></div><div className="v">${Number(h.live.collateralPrice).toFixed(4)}</div><div className="k">SLP share ${Number(h.live.sharePrice).toFixed(4)}</div></div>
              </div>
              <div className="card">
                <h2>Breakdown</h2>
                <dl className="kv">
                  <dt>Collateral value C</dt><dd>${h.values.collateralValueUsd}</dd>
                  <dt>Vault value V</dt><dd>${h.values.vaultValueUsd}</dd>
                  <dt>c = C/D · v = V/D</dt><dd>{h.values.c} · {h.values.v}</dd>
                  <dt>Joint / floor health</dt><dd>{h.health.joint} / {h.health.floor}</dd>
                  <dt>Completion targets</dt><dd>J* {h.targets.Jstar} · F* {h.targets.Fstar}</dd>
                  <dt>Fix to targets</dt><dd>{h.fixToCompletionTargets.alreadyMeets ? "none needed" : `repay $${h.fixToCompletionTargets.repayUsd} or add ${h.fixToCompletionTargets.orAddCollateralUnits} ${h.inputs.asset}`}</dd>
                  <dt>Parameters</dt><dd>M {h.params.M} · X {h.params.X} · d {h.params.d} · Y {h.params.Y} · F {h.params.F} · r {h.params.r}</dd>
                </dl>
                <p className="basis">{h.health.note}. {h.params.basis}.</p>
              </div>
            </>
          )}
          {g && (
            <div className="card">
              <h2>Stress heatmap <span className="lbl">SCENARIO</span></h2>
              <div className="tablewrap">
                <table className="heat">
                  <thead><tr><th>SLP ↓ / {f.asset} →</th>{g.colsAreCollateralChangePct.map((c) => <th key={c} className="num">{c}%</th>)}</tr></thead>
                  <tbody>
                    {g.grid.map((row, i) => (
                      <tr key={i}>
                        <th>{g.rowsAreVaultDrawdownPct[i]}%</th>
                        {row.map((c) => (
                          <td key={c.collateralChangePct} className="num" style={{ background: color(Number(c.health), c.state === "RECOVERY") }} title={`J ${c.J} · ${c.state}`}>
                            {Number(c.health).toFixed(0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="basis">Red = Recovery (J ≥ 1 or c ≤ F). Green ≥ joint completion threshold 112.28.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
