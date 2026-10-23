import { useMemo, useState } from "react";
import { type GapRow, type PositionGapRisk, type Proposal, type Source, type Status, api } from "./api";
import { BandPill, Lbl, ModeBadge, PageHead, SessionChip, Term, fmt, pct, plainVerdict, useAsync, when } from "./ui";

const KIND_TITLE: Record<string, string> = { protective_stop: "Stop-loss", partial_close: "Reduce the position", iso_margin_add: "Add margin", open: "New position", cancel: "Cancel order" };
const coin = (s: string) => s.replace("-USD", "");

function explain(p: Proposal): string {
  const a = p.action as unknown as Record<string, string>;
  if (a.kind === "protective_stop") return `If ${coin(a.symbol ?? "")} reaches $${fmt(a.stopPrice)}, Apex closes the ${fmt(a.size, 4)} position (reduce-only, so it can never grow or flip it). It rests there until triggered.`;
  if (a.kind === "partial_close") return `Closes ${fmt(a.size, 4)} ${coin(a.symbol ?? "")} right away at market (reduce-only), which moves your liquidation price further away.`;
  if (a.kind === "iso_margin_add") return `Moves $${fmt(a.amount)} of free balance into this position's margin to push liquidation further away.`;
  return p.summary;
}

function ProposalCard({ p, onDone }: { p: Proposal; onDone: () => void }) {
  const [res, setRes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = p.mode === "live";
  const ok = p.verdict.decision === "APPROVE";
  const go = async () => {
    if (live && !window.confirm(`LIVE: send this order to Strike?\n\n${p.summary}`)) return;
    setBusy(true);
    try {
      const r = await api.execute(p.id);
      setRes(`${r.label}: ${r.status} — recorded as entry #${r.logSeq} in the audit log`);
      onDone();
    } catch (e) {
      setRes(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="proposal">
      <div className="prop-head"><ModeBadge mode={live ? "LIVE" : "PAPER"} /><b>{KIND_TITLE[p.action.kind] ?? p.action.kind}</b>{ok ? <span className="ok-t">Passes all safety checks</span> : <span className="bad-t">Blocked</span>}</div>
      <p style={{ margin: "6px 0" }}>{explain(p)}</p>
      {!ok && <ul className="reasons">{plainVerdict(p.verdict).map((x) => <li key={x.id}><b>{x.title}.</b> {x.message}</li>)}</ul>}
      <p className="basis" style={{ margin: 0 }}>A stop-loss does not protect against a gap <i>through</i> it: if the price jumps past the stop, it fills at the next available price.</p>
      <div className="prop-act">
        <button className={live ? "btn danger" : "btn"} disabled={busy || !ok || res !== null} onClick={go}>{busy ? "Working…" : live ? "Confirm and send to Strike" : "Confirm (paper)"}</button>
        <span className="muted">Nothing happens until you confirm · expires {new Date(p.expiresAt).toLocaleTimeString()}</span>
      </div>
      {res && <div className="prop-res">✓ {res}</div>}
    </div>
  );
}

const SOURCES: Array<[Source, string, string]> = [
  ["paper", "Apex paper account", "Simulated positions on live prices. Safe to click around."],
  ["vault", "Strike SLP vault", "A real, public Strike vault, read-only. Shows real positions."],
  ["own", "My Strike account", "Your real positions (needs API keys on your own machine)."],
];

export function Positions({ source, setSource, status }: { source: Source; setSource: (s: Source) => void; status: Status | null }) {
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
  const ranked = useMemo(() => [...(w.data?.markets ?? [])].sort((a, b) => Number(b.pMove5Long ?? -1) - Number(a.pMove5Long ?? -1)), [w.data]);
  const maxP = Math.max(1, ...ranked.map((g) => Number(g.pMove5Long ?? 0)));
  const label = w.data?.positionsLabel ?? "";
  const hint = SOURCES.find(([s]) => s === source)?.[2];

  return (
    <>
      <PageHead
        title="Weekend risk"
        badge={<ModeBadge mode={source === "paper" ? "PAPER" : "LIVE"} />}
        what={<>Stock and index perps keep trading after their <Term k="session">real market</Term> closes. This page shows how likely a <Term k="gap">weekend gap</Term> is to <Term k="liquidation">liquidate</Term> each position, and lets you add protection with one confirmation.</>}
        tip={<>look at the <b>Gap chance</b> column, then press <b>Add protection</b> on a position.</>}
      />
      <div className="legend">
        <span><b>Gap chance</b> = chance a closed-market move reaches your liquidation price:</span>
        <BandPill band="LOW">Low · under 5%</BandPill><BandPill band="MEDIUM">Medium · 5–20%</BandPill><BandPill band="HIGH">High · over 20%</BandPill>
      </div>
      <div className="filters">
        {SOURCES.map(([s, name]) => (
          <button key={s} className={source === s ? "on" : ""} disabled={s === "own" && !status?.hasKeys} onClick={() => setSource(s)} title={s === "own" && !status?.hasKeys ? "Needs API keys in .env on your own machine" : ""}>{name}</button>
        ))}
        <span className="muted" style={{ alignSelf: "center", fontSize: 13 }}>{hint}</span>
        <span className="spacer" />
        <button onClick={w.reload}>{w.loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      {w.error && <p className="err">{w.error}</p>}
      {w.loading && !w.data && <p className="loading">Reading live positions and price history for every stock and index market… this takes a few seconds the first time.</p>}
      {w.data && (
        <div className="grid">
          <div className="card">
            <h2>Positions — {label}</h2>
            {w.data.positions.length === 0 && <p className="muted">No open positions in this account yet. Use <b>Check a trade</b> to see what a position would look like, or switch to the Strike SLP vault to see real positions.</p>}
            {w.data.positions.length > 0 && (
              <div className="tablewrap">
                <table>
                  <thead><tr>
                    <th>Market</th><th>Direction</th><th className="num">Size</th><th className="num"><Term k="mark">Price now</Term></th>
                    <th className="num"><Term k="liquidation">Liquidation price</Term></th><th className="num">Room before it</th><th><Term k="session">Real market</Term></th><th><Term k="gapchance">Gap chance</Term></th><th></th>
                  </tr></thead>
                  <tbody>
                    {w.data.positions.map((p: PositionGapRisk) => (
                      <tr key={p.symbol}>
                        <td><b>{coin(p.symbol)}</b>{p.flags.map((f) => <span key={f} className="chip flag" title={f === "UNDERLYING_UNKNOWN" ? "Real-market hours unknown" : f === "THIN_BOOK" ? "Thin order book: big orders move the price" : "Price hasn't moved for hours"}>{f === "UNDERLYING_UNKNOWN" ? "hours?" : f === "THIN_BOOK" ? "thin book" : "stale price"}</span>)}</td>
                        <td>{p.side === "long" ? "Long" : "Short"}</td>
                        <td className="num">{fmt(p.size, 4)}</td><td className="num">{fmt(p.markPrice)}</td>
                        <td className="num">{p.liquidationPrice === "0" ? <span className="muted">none</span> : fmt(p.liquidationPrice)}</td>
                        <td className="num">{p.liquidationDistancePct === null ? "—" : pct(p.liquidationDistancePct, 1)}</td>
                        <td><SessionChip s={p.underlying} /></td>
                        <td>{p.pGapPct === null ? <span className="muted">n/a (crypto)</span> : <><BandPill band={p.band}>{p.band}</BandPill> <span className="mono">{p.pGapPct}%</span><div className="basis" style={{ margin: 0 }}>{p.method === "EMPIRICAL" ? `${p.samples} real gaps` : "modeled"}</div></>}</td>
                        <td>{source !== "vault" && !status?.readOnly && <button className="btn ghost" disabled={busy === p.symbol} onClick={() => protect(p.symbol)}>{busy === p.symbol ? "…" : "Add protection"}</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {status?.readOnly && w.data.positions.length > 0 && <p className="basis">This public demo is read-only, so protection can't be confirmed here. Run Apex locally to try the full flow: propose → confirm → record.</p>}
            {Object.entries(props).map(([sym, ps]) => (
              <div key={sym} style={{ marginTop: 14 }}>
                <h2>Suggested protection for {coin(sym)}</h2>
                {ps.length === 0 && <p className="muted">Apex couldn't build a protection for this position.</p>}
                {ps.map((p) => <ProposalCard key={p.id} p={p} onDone={w.reload} />)}
              </div>
            ))}
          </div>

          <div className="card">
            <h2>Which markets carry the most weekend-gap risk? <Lbl l="ESTIMATE" /></h2>
            <p className="muted" style={{ marginTop: -6 }}>For every stock, index and commodity perp: the chance that a closed-market move alone knocks a long position down 5% or 10%. Sorted riskiest first.</p>
            <div className="tablewrap">
              <table>
                <thead><tr>
                  <th>Market</th><th><Term k="session">Real market</Term></th><th>Reopens</th><th>Chance of a −5% gap</th><th className="num">−10%</th><th className="num">Worst gap seen</th><th>Based on</th><th><Term k="gap">Fair price</Term></th>
                </tr></thead>
                <tbody>
                  {ranked.map((m: GapRow) => (
                    <tr key={m.symbol}>
                      <td><b>{coin(m.symbol)}</b></td>
                      <td><SessionChip s={m.underlying} /></td>
                      <td className="muted">{m.underlying === "open" ? "—" : m.nextOpen ? when(m.nextOpen) : `~${m.windowHours}h window`}</td>
                      <td>
                        <div className="inbar"><div className={`inbar-f ${m.method}`} style={{ width: `${(Number(m.pMove5Long ?? 0) / maxP) * 100}%` }} /><span>{m.pMove5Long === null ? "—" : `${Number(m.pMove5Long).toFixed(1)}%`}</span></div>
                      </td>
                      <td className="num">{pct(m.pMove10Long, 1)}</td>
                      <td className="num">{pct(m.worstAdverseLongPct, 1)}</td>
                      <td className="muted">{m.method === "EMPIRICAL" ? <Term k="empirical">{m.samples} real gaps</Term> : <Term k="modeled">modeled</Term>}</td>
                      <td className="muted" title={m.fairValue?.note ?? ""}>{m.fairValue?.status === "OK" ? `${fmt(m.fairValue.implied)} ±${m.fairValue.bandHalfWidthPct}%` : m.fairValue ? "no reliable estimate" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="basis">Solid bars use real past gaps from Strike's price history; striped bars are modeled. "Fair price" is an Apex estimate of where the perp should trade while its real market is closed, using the Nasdaq-100 perp.</p>
          </div>
        </div>
      )}
    </>
  );
}
