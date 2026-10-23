import { useEffect, useState } from "react";
import { type LogEntry, type VaultStatus, api } from "./api";
import { ModeBadge, PageHead } from "./ui";

export function Vault({ readOnly = false }: { readOnly?: boolean }) {
  const [v, setV] = useState<VaultStatus | null>(null);
  const [d, setD] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => Promise.all([api.vault(), api.vaultDecisions()]).then(([a, b]) => { setV(a); setD(b.decisions); }, (e: unknown) => setErr(String(e)));
  useEffect(() => { void load(); }, []);
  const tick = async () => {
    setBusy(true);
    try {
      await api.vaultTick();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const m = v?.mandate;
  return (
    <>
      <PageHead
        title="Mandate Vault"
        badge={<ModeBadge mode="PAPER" />}
        what={<>A vault that runs by a written rulebook (the mandate below) instead of by gut feel. While a stock's real market is closed, it only trades when the perp drifts unusually far from its estimated fair price, never holds through the reopen, and checks every trade with the Risk Referee. It is simulated on live prices: no real vault is traded.</>}
        tip={<>read the <b>Decisions</b> table. Each row says in plain words why the vault did, or did not, trade.</>}
      />
      {err && <p className="err">{err}</p>}
      {v && m && (
        <div className="grid">
          <div className="grid cols-4">
            <div className="card kpi"><div className="k">Paper equity</div><div className="v">${v.equityUsd}</div><div className="k">start ${v.startingEquityUsd}</div></div>
            <div className="card kpi"><div className="k">Return</div><div className="v" style={{ color: Number(v.returnPct) >= 0 ? "var(--ok)" : "var(--danger)" }}>{v.returnPct}%</div></div>
            <div className="card kpi"><div className="k">Drawdown</div><div className="v">{v.drawdownPct}%</div><div className="k">flatten all above {m.emergency.flattenAllIfDrawdownPctAbove}%</div></div>
            <div className="card kpi"><div className="k">Positions · actions 24h</div><div className="v">{v.positions.length} · {v.actionsToday}</div><div className="k">max {m.maxActionsPerDay}/day</div></div>
          </div>
          <div className="grid cols-2">
            <div className="card">
              <h2>{m.name}</h2>
              <p style={{ marginTop: 0 }}>{m.description}</p>
              <dl className="kv">
                <dt>Symbols</dt><dd>{m.allowedSymbols.join(", ")}</dd>
                <dt>Max leverage</dt><dd>{m.maxLeverage}x</dd>
                <dt>Max position / exposure</dt><dd>${m.maxPositionNotionalUsd} / ${m.maxExposureUsd}</dd>
                <dt>Min liquidation distance</dt><dd>{m.minLiquidationDistancePct}%</dd>
                <dt>Signal</dt><dd>|mark − implied| &gt; {m.signal.deviationMultipleOfHalfWidth} × half-width</dd>
                <dt>Session rule</dt><dd>only while closed; flat {m.weekend.flatMinutesBeforeOpen} min before open</dd>
              </dl>
              {readOnly ? <p className="basis">The server runs this mandate check every 30 minutes; decisions appear below.</p> : <div style={{ marginTop: 12 }}><button className="btn" disabled={busy} onClick={tick}>{busy ? "Evaluating…" : "Run mandate check now"}</button></div>}
              <p className="basis">Source: config/mandate.json (published in the repo).</p>
            </div>
            <div className="card">
              <h2>Paper positions</h2>
              {v.positions.length === 0 ? <p className="muted">Flat.</p> : (
                <div className="tablewrap"><table><thead><tr><th>Market</th><th className="num">Size</th><th className="num">Entry</th><th className="num">Margin</th></tr></thead>
                  <tbody>{v.positions.map((p) => <tr key={p.symbol}><td><b>{p.symbol}</b></td><td className="num">{p.size}</td><td className="num">{Number(p.entry_price).toFixed(4)}</td><td className="num">${p.iso_balance}</td></tr>)}</tbody></table></div>
              )}
            </div>
          </div>
          <div className="card">
            <h2>Decisions</h2>
            <div className="tablewrap">
              <table>
                <thead><tr><th>#</th><th>Time</th><th>Market</th><th>Outcome</th><th>Reasoning</th></tr></thead>
                <tbody>
                  {d.map((e) => {
                    const p = e.payload as { symbol: string; outcome: string; reasoning: string };
                    return <tr key={e.seq}><td className="num">{e.seq}</td><td className="muted">{new Date(e.ts).toLocaleString()}</td><td><b>{p.symbol}</b></td><td><span className={`chip ${p.outcome === "opened" ? "open" : p.outcome === "blocked" ? "unknown" : ""}`}>{p.outcome}</span></td><td style={{ whiteSpace: "normal", minWidth: 320 }}>{p.reasoning}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
            {d.length === 0 && <p className="muted">No decisions yet — run a mandate check.</p>}
          </div>
        </div>
      )}
    </>
  );
}
