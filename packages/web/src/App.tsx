import { useCallback, useEffect, useMemo, useState } from "react";
import { Credit } from "./Credit";
import { Vault } from "./Vault";
import { type CircuitReport, type FairValue, type LogEntry, type MarketGapStats, type MarketRecord, type PositionGapRisk, type Proposal, type Source, type Status, type Verdict, api } from "./api";

type Page = "radar" | "circuit" | "positions" | "credit" | "vault" | "log";
const DISCLAIMER = "Numbers are estimates from live Strike data, not guarantees, and not financial advice. Limits are enforced by Strike key permissions and the Apex referee, not by an on-chain contract.";

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 29 28H3z" fill="var(--accent)" /><path d="M16 12 22 24H10z" fill="var(--bg)" /></svg>
  );
}

function ModeBadge({ mode }: { mode: "LIVE" | "PAPER" | "SCENARIO" }) {
  return <span className={`badge ${mode}`}><span className="dot" />{mode}</span>;
}

function Lbl({ l }: { l: string }) {
  return <span className="lbl">{l}</span>;
}

const fmt = (v: string | null | undefined, dp = 2) => {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const a = Math.abs(n);
  const d = a >= 1000 ? 2 : a >= 1 ? dp : a >= 0.01 ? 4 : 8;
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
};
const pct = (v: string | null | undefined, dp = 2) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(dp)}%`);
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    fn().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { data, error, loading, reload: run };
}

// ── Markets radar ────────────────────────────────────────────────────────────
function Radar() {
  const m = useAsync(() => api.markets(), []);
  const [cls, setCls] = useState<string>("all");
  const rows = useMemo(() => (m.data?.markets ?? []).filter((x) => cls === "all" || x.class === cls), [m.data, cls]);
  const counts = useMemo(() => {
    const ms = m.data?.markets ?? [];
    return { total: ms.length, closed: ms.filter((x) => x.sessionState.underlying === "closed").length, unknown: ms.filter((x) => x.sessionState.underlying === "unknown").length, mismatch: ms.filter((x) => x.notes.some((n) => n.startsWith("CATEGORY_MISMATCH"))).length };
  }, [m.data]);
  return (
    <>
      <h1>Markets radar</h1>
      <p className="sub">Every Strike perp with its underlying session. Stock and index perps keep trading when their cash market is closed — that is where weekend gaps come from.</p>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card kpi"><div className="k">Markets <Lbl l="LIVE" /></div><div className="v">{counts.total}</div></div>
        <div className="card kpi"><div className="k">Underlying closed</div><div className="v" style={{ color: "var(--warn)" }}>{counts.closed}</div></div>
        <div className="card kpi"><div className="k">Session unknown</div><div className="v" style={{ color: "var(--danger)" }}>{counts.unknown}</div></div>
        <div className="card kpi"><div className="k">API category corrected</div><div className="v">{counts.mismatch}</div></div>
      </div>
      <div className="card">
        <div className="filters">
          {["all", "crypto", "equity", "index", "commodity"].map((c) => (
            <button key={c} className={cls === c ? "on" : ""} onClick={() => setCls(c)}>{c}</button>
          ))}
          <span className="spacer" />
          <button onClick={m.reload}>{m.loading ? "Refreshing…" : "Refresh"}</button>
        </div>
        {m.error && <p className="err">{m.error}</p>}
        <div className="tablewrap">
          <table>
            <thead><tr><th>Market</th><th>Class</th><th>Perp</th><th>Underlying</th><th>Next open</th><th className="num">Mark</th><th className="num">Funding / h</th><th className="num">Open interest $</th><th className="num">24h vol $</th><th>Notes</th></tr></thead>
            <tbody>
              {rows.map((x: MarketRecord) => (
                <tr key={x.symbol}>
                  <td><b>{x.symbol}</b></td>
                  <td>{x.class}</td>
                  <td>{x.perpStatus}</td>
                  <td><span className={`chip ${x.sessionState.underlying}`}>{x.sessionState.underlying}</span></td>
                  <td className="muted">{x.class === "crypto" ? "24/7" : when(x.sessionState.nextOpen)}</td>
                  <td className="num">{fmt(x.stats.markPrice)}</td>
                  <td className="num">{(Number(x.stats.fundingRateHourly) * 100).toFixed(5)}%</td>
                  <td className="num">{fmt(x.stats.openInterest, 0)}</td>
                  <td className="num">{fmt(x.stats.volume24h, 0)}</td>
                  <td>{x.notes.map((n) => <span key={n} className="chip note" title={n} style={{ marginRight: 4 }}>{n.split(":")[0]}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {m.loading && !m.data && <p className="loading">Loading live markets…</p>}
      </div>
    </>
  );
}

// ── Circuit ──────────────────────────────────────────────────────────────────
function VerdictBox({ v }: { v: Verdict }) {
  return (
    <div className={`verdict ${v.decision}`}>
      <div className="t">Risk Referee: {v.decision}</div>
      {v.violations.length > 0 && <ul>{v.violations.map((r) => <li key={r.id}><b>{r.id}</b> {r.message}</li>)}</ul>}
      {v.warnings.length > 0 && <ul className="muted">{v.warnings.map((r) => <li key={r.id}><b>{r.id}</b> {r.message}</li>)}</ul>}
    </div>
  );
}

function N({ n }: { n: { value: string | null; label: string; basis: string } }) {
  return <>{fmt(n.value)}<Lbl l={n.label} /></>;
}

function CircuitReportView({ r, title }: { r: CircuitReport; title: string }) {
  return (
    <div className="grid" style={{ gap: 12 }}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      <VerdictBox v={r.verdict} />
      {r.stale.stale && <p className="err">STALE: {r.stale.reasons.join("; ")}</p>}
      {r.exchangeWarnings.map((w) => <p key={w} className="err">{w}</p>)}
      <div className="grid cols-4">
        <div className="card kpi"><div className="k">Size</div><div className="v">{fmt(r.size.value, 4)}</div></div>
        <div className="card kpi"><div className="k">Notional $ <Lbl l="ESTIMATE" /></div><div className="v">{fmt(r.notionalUsd.value)}</div></div>
        <div className="card kpi"><div className="k">Liquidation <Lbl l="ESTIMATE" /></div><div className="v">{r.liquidation.price.value?.startsWith("0") ? "none" : fmt(r.liquidation.price.value)}</div></div>
        <div className="card kpi"><div className="k">Distance</div><div className="v" style={{ color: Number(r.liquidation.distancePct.value) < 15 ? "var(--danger)" : "var(--ok)" }}>{pct(r.liquidation.distancePct.value)}</div></div>
      </div>
      <div className="grid cols-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div className="card">
          <h2>Execution</h2>
          <dl className="kv">
            <dt>Mark</dt><dd><N n={r.markPrice} /></dd>
            <dt>Est. entry</dt><dd><N n={r.entryPrice} /></dd>
            <dt>Slippage vs mark</dt><dd>{fmt(r.slippage.slippageBpsVsMark.value)} bps{r.slippage.insufficientDepth && <span className="err"> insufficient depth</span>}</dd>
            <dt>Open fee</dt><dd>${fmt(r.fees.openCostUsd.value, 4)}</dd>
            <dt>Close fee</dt><dd>${fmt(r.fees.closeCostUsd.value, 4)}</dd>
            <dt>Funding / 24h</dt><dd>${fmt(r.funding.costPer24hUsd.value, 4)}</dd>
          </dl>
          <p className="basis">{r.liquidation.basis}. {r.fees.tierNote}</p>
        </div>
        <div className="card">
          <h2>Stress <Lbl l="SCENARIO" /></h2>
          <table>
            <thead><tr><th>Adverse move</th><th className="num">Price</th><th className="num">PnL $</th><th></th></tr></thead>
            <tbody>{r.stress.map((s) => <tr key={s.movePct}><td>−{s.movePct}%</td><td className="num">{fmt(s.price.value)}</td><td className="num">{fmt(s.pnlUsd.value)}</td><td>{s.liquidated && <span className="chip flag">LIQUIDATED</span>}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="card">
          <h2>Portfolio impact</h2>
          <dl className="kv">
            <dt>Total notional</dt><dd>${fmt(r.portfolio.before.totalNotionalUsd.value)} → ${fmt(r.portfolio.after.totalNotionalUsd.value)}</dd>
            <dt>Concentration</dt><dd>{pct(r.portfolio.before.concentrationPct.value)} → {pct(r.portfolio.after.concentrationPct.value)}</dd>
            <dt>Margin utilization</dt><dd>{pct(r.portfolio.before.marginUtilizationPct.value)} → {pct(r.portfolio.after.marginUtilizationPct.value)}</dd>
          </dl>
          <p className="basis">{r.portfolio.accountSource}</p>
        </div>
        <div className="card">
          <h2>Weekend exposure</h2>
          <dl className="kv">
            <dt>Underlying</dt><dd><span className={`chip ${r.weekend.underlying}`}>{r.weekend.underlying}</span></dd>
            <dt>Hours to open</dt><dd>{r.weekend.hoursUntilNextOpen.value ?? "—"}</dd>
            <dt>Gap method</dt><dd>{r.weekend.gap ? `${r.weekend.gap.method} (n=${r.weekend.gap.samples})` : "crypto — n/a"}</dd>
          </dl>
          {r.riskReward && <p className="basis">R/R: loss ${fmt(r.riskReward.lossUsd.value)} / gain ${fmt(r.riskReward.gainUsd.value)} = {fmt(r.riskReward.ratio.value)}</p>}
        </div>
      </div>
    </div>
  );
}

function Circuit({ source }: { source: Source }) {
  const [f, setF] = useState({ symbol: "NVDA-USD", side: "buy", notionalUsd: "1000", leverage: "10", orderType: "market", stopLoss: "", takeProfit: "" });
  const [r, setR] = useState<CircuitReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const markets = useAsync(() => api.markets(), []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const run = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setR(await api.simulate({ symbol: f.symbol, side: f.side, notionalUsd: f.notionalUsd, leverage: Number(f.leverage), orderType: f.orderType, ...(f.stopLoss ? { stopLoss: f.stopLoss } : {}), ...(f.takeProfit ? { takeProfit: f.takeProfit } : {}), source }));
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Circuit <ModeBadge mode="SCENARIO" /></h1>
      <p className="sub">Simulate a trade before it exists: liquidation from Strike's margin-tier formulas, fees, order-book slippage, funding, stress and the referee's verdict. Nothing is sent to Strike.</p>
      <div className="grid cols-2">
        <form className="card stack" onSubmit={run}>
          <h2>Trade</h2>
          <label>Market<select value={f.symbol} onChange={set("symbol")}>{(markets.data?.markets ?? [{ symbol: "NVDA-USD" } as MarketRecord]).map((m) => <option key={m.symbol}>{m.symbol}</option>)}</select></label>
          <div className="row2">
            <label>Side<select value={f.side} onChange={set("side")}><option value="buy">Long (buy)</option><option value="sell">Short (sell)</option></select></label>
            <label>Order<select value={f.orderType} onChange={set("orderType")}><option value="market">Market</option></select></label>
          </div>
          <div className="row2">
            <label>Notional (USD)<input inputMode="decimal" value={f.notionalUsd} onChange={set("notionalUsd")} /></label>
            <label>Leverage<input inputMode="numeric" value={f.leverage} onChange={set("leverage")} /></label>
          </div>
          <div className="row2">
            <label>Stop loss (optional)<input inputMode="decimal" value={f.stopLoss} onChange={set("stopLoss")} /></label>
            <label>Take profit (optional)<input inputMode="decimal" value={f.takeProfit} onChange={set("takeProfit")} /></label>
          </div>
          <button className="btn" disabled={busy}>{busy ? "Simulating…" : "Run Circuit"}</button>
          {err && <p className="err">{err}</p>}
        </form>
        <div>
          {!r && !busy && <div className="card muted">Run a simulation to see the report. Try the demo: $1,000 NVDA long at 10x.</div>}
          {busy && <div className="card loading">Reading live order book, margin tiers and history…</div>}
          {r && <CircuitReportView r={r} title={`${r.side === "buy" ? "Long" : "Short"} ${r.symbol} at ${r.leverage}x`} />}
          {r?.alternativeReport && <div style={{ marginTop: 16 }}><CircuitReportView r={r.alternativeReport} title={`Compliant alternative: ${r.alternativeReport.size.value} at ${r.alternativeReport.leverage}x`} /></div>}
        </div>
      </div>
    </>
  );
}

// ── Positions & Weekend Shield ───────────────────────────────────────────────
function ProposalCard({ p, onDone }: { p: Proposal; onDone: () => void }) {
  const [res, setRes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = p.mode === "live";
  const go = async () => {
    if (live && !window.confirm(`LIVE: send this order to Strike?\n\n${p.summary}`)) return;
    setBusy(true);
    try {
      const r = await api.execute(p.id);
      setRes(`${r.label}: ${r.status} (log #${r.logSeq})`);
      onDone();
    } catch (e) {
      setRes(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="proposal">
      <div><ModeBadge mode={live ? "LIVE" : "PAPER"} /> <b>{p.action.kind.replace(/_/g, " ")}</b> — {p.summary}</div>
      <VerdictBox v={p.verdict} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className={live ? "btn danger" : "btn"} disabled={busy || p.verdict.decision !== "APPROVE" || res !== null} onClick={go}>{busy ? "Executing…" : live ? "Confirm & send LIVE" : "Confirm (PAPER)"}</button>
        <span className="muted">Expires {new Date(p.expiresAt).toLocaleTimeString()}</span>
        {res && <span className="mono">{res}</span>}
      </div>
    </div>
  );
}

function Positions({ source, setSource, status }: { source: Source; setSource: (s: Source) => void; status: Status | null }) {
  const w = useAsync(() => api.weekend(source), [source]);
  const [props, setProps] = useState<Record<string, Proposal[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const protect = async (symbol: string) => {
    setBusy(symbol);
    try {
      const r = await api.proposeProtection(symbol, source);
      setProps({ ...props, [symbol]: r.proposals });
    } finally {
      setBusy(null);
    }
  };
  const label = w.data?.positionsLabel ?? "";
  return (
    <>
      <h1>Positions & Weekend Shield <ModeBadge mode={source === "paper" ? "PAPER" : "LIVE"} /></h1>
      <p className="sub">p_gap = probability that an adverse move while the underlying market is closed reaches your liquidation distance (from Strike's own mark history, or modeled when history is short).</p>
      <div className="filters">
        {(["own", "paper", "vault"] as Source[]).map((s) => (
          <button key={s} className={source === s ? "on" : ""} disabled={s === "own" && !status?.hasKeys} onClick={() => setSource(s)} title={s === "own" && !status?.hasKeys ? "Needs API keys in .env" : ""}>
            {s === "own" ? "My Strike account" : s === "paper" ? "Apex paper account" : "SLP vault (public, read-only)"}
          </button>
        ))}
        <span className="spacer" />
        <button onClick={w.reload}>{w.loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      {w.error && <p className="err">{w.error}</p>}
      {w.loading && !w.data && <p className="loading">Loading positions and 1h mark history for every TradFi market…</p>}
      {w.data && (
        <div className="grid">
          <div className="card">
            <h2>Positions — {label}</h2>
            {w.data.positions.length === 0 && <p className="muted">No open positions. Seed the paper account with <span className="mono">pnpm demo:seed</span> or simulate in Circuit.</p>}
            <div className="tablewrap">
              <table>
                <thead><tr><th>Market</th><th>Side</th><th className="num">Size</th><th className="num">Mark</th><th className="num">Liquidation</th><th className="num">Distance</th><th>Underlying</th><th className="num">p_gap</th><th>Band</th><th>Method</th><th>Flags</th><th></th></tr></thead>
                <tbody>
                  {w.data.positions.map((p: PositionGapRisk) => (
                    <tr key={p.symbol}>
                      <td><b>{p.symbol}</b></td><td>{p.side}</td><td className="num">{fmt(p.size, 4)}</td><td className="num">{fmt(p.markPrice)}</td>
                      <td className="num">{p.liquidationPrice === "0" ? "none" : fmt(p.liquidationPrice)}</td><td className="num">{pct(p.liquidationDistancePct)}</td>
                      <td><span className={`chip ${p.underlying}`}>{p.underlying}</span></td>
                      <td className="num">{p.pGapPct === null ? "—" : `${p.pGapPct}%`}</td><td><span className={`band ${p.band}`}>{p.band}</span></td>
                      <td className="muted">{p.method}{p.method !== "N/A" ? ` n=${p.samples}` : ""}</td>
                      <td>{p.flags.map((f) => <span key={f} className="chip flag">{f}</span>)}</td>
                      <td>{source !== "vault" && <button className="btn ghost" disabled={busy === p.symbol} onClick={() => protect(p.symbol)}>{busy === p.symbol ? "…" : "Protect"}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.entries(props).map(([sym, ps]) => (
              <div key={sym} style={{ marginTop: 12 }}>
                <h2>Proposals for {sym}</h2>
                {ps.length === 0 && <p className="muted">No proposal could be built.</p>}
                {ps.map((p) => <ProposalCard key={p.id} p={p} onDone={w.reload} />)}
              </div>
            ))}
          </div>
          <div className="card">
            <h2>Closed-session gap statistics <Lbl l="ESTIMATE" /></h2>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Market</th><th>Underlying</th><th className="num">Hours to open</th><th className="num">Window h</th><th>Method</th><th className="num">Samples</th><th className="num">σ 1h</th><th className="num">Worst long</th><th className="num">P(−5%)</th><th className="num">P(−10%)</th><th>Fair value <span className="lbl">ESTIMATE</span></th><th>Flags</th></tr></thead>
                <tbody>
                  {w.data.markets.map((m: MarketGapStats & { fairValue: FairValue | null }) => (
                    <tr key={m.symbol}>
                      <td><b>{m.symbol}</b></td><td><span className={`chip ${m.underlying}`}>{m.underlying}</span></td>
                      <td className="num">{m.hoursUntilNextOpen ?? "—"}</td><td className="num">{m.windowHours ?? "—"}</td><td>{m.method}</td><td className="num">{m.samples}</td>
                      <td className="num">{pct(m.sigmaHourlyPct, 3)}</td><td className="num">{pct(m.worstAdverseLongPct)}</td><td className="num">{pct(m.pMove5Long, 1)}</td><td className="num">{pct(m.pMove10Long, 1)}</td>
                      <td className="muted" title={m.fairValue?.note ?? ""}>{m.fairValue ? (m.fairValue.status === "OK" ? `${fmt(m.fairValue.implied)} ±${m.fairValue.bandHalfWidthPct}% (mark ${Number(m.fairValue.deviationPct) >= 0 ? "+" : ""}${m.fairValue.deviationPct}%)` : m.fairValue.status.replace(/_/g, " ").toLowerCase()) : "—"}</td>
                      <td>{m.flags.map((f) => <span key={f} className="chip flag">{f}</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Decision log ─────────────────────────────────────────────────────────────
function Log() {
  const l = useAsync(() => api.log(200), []);
  const [v, setV] = useState<Awaited<ReturnType<typeof api.verify>> | null>(null);
  const verify = async () => setV(await api.verify());
  return (
    <>
      <h1>Decision log</h1>
      <p className="sub">Append-only, hash-chained and Ed25519-signed with a key separate from the trading key. Every proposal, verdict and execution lands here.</p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" onClick={verify}>Verify chain & signatures</button>
          <button className="btn ghost" onClick={l.reload}>Refresh</button>
          {v && (v.ok ? <span className="ok">✓ {v.entries} entries verified — key {v.publicKey.slice(0, 16)}…</span> : <span className="err">✗ verification failed at seq {v.firstBadSeq}: {v.error}</span>)}
        </div>
      </div>
      <div className="card">
        <div className="tablewrap">
          <table>
            <thead><tr><th>#</th><th>Time</th><th>Type</th><th>Mode</th><th>Detail</th><th>Hash</th></tr></thead>
            <tbody>
              {(l.data?.entries ?? []).map((e: LogEntry) => (
                <tr key={e.seq}>
                  <td className="num">{e.seq}</td><td className="muted">{new Date(e.ts).toLocaleString()}</td><td><b>{e.type}</b></td>
                  <td><ModeBadge mode={e.mode === "live" ? "LIVE" : e.mode === "paper" ? "PAPER" : "SCENARIO"} /></td>
                  <td className="logentry" style={{ whiteSpace: "normal", minWidth: 280 }}>{summarize(e)}</td>
                  <td className="mono muted">{e.hash.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function summarize(e: LogEntry): string {
  const p = e.payload as Record<string, unknown>;
  if (e.type === "proposal") return `${p.decision} — ${p.summary}`;
  if (e.type === "execution") return `${String(p.status)} — ${JSON.stringify(p.action)}`;
  if (e.type === "simulation") return `${p.decision} ${JSON.stringify(p.violations)} — ${JSON.stringify(p.input)}`;
  if (e.type === "execution_blocked") return `${String(p.status)}: ${JSON.stringify(p.details)}`;
  return JSON.stringify(p).slice(0, 220);
}

// ── App ──────────────────────────────────────────────────────────────────────
export function App() {
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) as Page) || "radar");
  const [status, setStatus] = useState<Status | null>(null);
  const [source, setSource] = useState<Source>("paper");
  useEffect(() => {
    api.status().then((s) => { setStatus(s); setSource(s.defaultSource); }, () => undefined);
  }, []);
  useEffect(() => { location.hash = page; }, [page]);
  useEffect(() => {
    const on = () => setPage((location.hash.slice(1) as Page) || "radar");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const tabs: Array<[Page, string]> = [["radar", "Markets"], ["circuit", "Circuit"], ["positions", "Positions"], ["credit", "Credit"], ["vault", "Vault"], ["log", "Decision log"]];
  return (
    <>
      <header className="top">
        <div className="top-inner">
          <div className="brand"><Logo />APEX <small>risk desk for Strike</small></div>
          <nav>{tabs.map(([k, t]) => <button key={k} className={page === k ? "on" : ""} onClick={() => setPage(k)}>{t}</button>)}</nav>
          <span className="spacer" />
          {status && <span className="muted" style={{ fontSize: 12 }}>{status.env}{status.hasKeys ? "" : " · no API keys"}</span>}
          <ModeBadge mode={status?.mode === "live" ? "LIVE" : "PAPER"} />
        </div>
      </header>
      <main>
        {page === "radar" && <Radar />}
        {page === "circuit" && <Circuit source={source} />}
        {page === "positions" && <Positions source={source} setSource={setSource} status={status} />}
        {page === "credit" && <Credit />}
        {page === "vault" && <Vault />}
        {page === "log" && <Log />}
        <p className="disclaimer">{DISCLAIMER}</p>
      </main>
    </>
  );
}
