import { useEffect, useMemo, useState } from "react";
import { type MarketRecord, api } from "./api";
import { PageHead, SessionChip, TYPE_LABEL, Term, fmt, useAsync, when } from "./ui";

const NOTE_TEXT: Record<string, string> = {
  CATEGORY_MISMATCH: "Strike's API labels this market \"Crypto\", but it is a stock or index. Apex corrected it from a cited session map.",
  UNDERLYING_UNKNOWN: "The real market's hours aren't known, so Apex treats it as closed (the careful assumption).",
  SESSION_ASSUMED: "The real market's hours are assumed, not verified.",
  NO_SESSION_ENTRY: "No cited session for this market, so its hours are treated as unknown.",
  FILTERS_MISSING: "Exchange order rules are incomplete, so orders are blocked.",
};
const noteText = (n: string) => NOTE_TEXT[n.split(":")[0]!] ?? n;

const TYPES: Array<[string, string]> = [["all", "All"], ["crypto", "Crypto"], ["equity", "Stocks"], ["index", "Indices"], ["commodity", "Commodities"]];

export function Markets() {
  const m = useAsync(() => api.markets(), []);
  const [cls, setCls] = useState("all");
  const [q, setQ] = useState("");
  const [closedOnly, setClosedOnly] = useState(false);
  useEffect(() => {
    const t = setInterval(m.reload, 15_000);
    return () => clearInterval(t);
  }, [m.reload]);
  const all = m.data?.markets ?? [];
  const rows = useMemo(
    () => all.filter((x) => (cls === "all" || x.class === cls) && (!closedOnly || x.sessionState.underlying !== "open") && x.symbol.toLowerCase().includes(q.trim().toLowerCase())),
    [all, cls, q, closedOnly],
  );
  const tradfi = all.filter((x) => x.class !== "crypto");
  const closed = tradfi.filter((x) => x.sessionState.underlying === "closed").length;
  const unknown = tradfi.filter((x) => x.sessionState.underlying === "unknown").length;
  return (
    <>
      <PageHead
        title="Markets"
        what={<>Every <Term k="perp">perpetual</Term> on Strike, live. Crypto trades around the clock. Stock, index and commodity perps also trade around the clock, but the <Term k="session">real market</Term> behind them closes, and that is when <Term k="gap">weekend gaps</Term> build up.</>}
        tip={<>filter to <b>Stocks</b>, or tick <b>Only closed</b>, to see which perps are trading without their real market.</>}
      />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card kpi"><div className="k">Markets on Strike <span className="lbl">LIVE</span></div><div className="v">{all.length || "—"}</div></div>
        <div className="card kpi"><div className="k">Stock & index perps tracked</div><div className="v">{tradfi.length || "—"}</div></div>
        <div className="card kpi"><div className="k">Real market closed right now</div><div className="v" style={{ color: "var(--warn)" }}>{closed}</div><div className="k">perp still trading</div></div>
        <div className="card kpi"><div className="k">Hours unknown</div><div className="v" style={{ color: "var(--danger)" }}>{unknown}</div><div className="k">treated as closed</div></div>
      </div>
      <div className="card">
        <div className="filters">
          {TYPES.map(([k, label]) => <button key={k} className={cls === k ? "on" : ""} onClick={() => setCls(k)}>{label}</button>)}
          <label className="check"><input type="checkbox" checked={closedOnly} onChange={(e) => setClosedOnly(e.target.checked)} /> Only closed / unknown</label>
          <span className="spacer" />
          <input className="search" placeholder="Search a market, e.g. NVDA" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
        </div>
        {m.error && <p className="err">{m.error}</p>}
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Market</th><th>Type</th><th><Term k="session">Real market</Term></th><th>Reopens</th>
                <th className="num"><Term k="mark">Price</Term></th><th className="num">24h</th><th className="num"><Term k="funding">Funding / h</Term></th><th className="num">Open interest</th><th className="num">24h volume</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x: MarketRecord) => (
                <tr key={x.symbol}>
                  <td><b>{x.symbol.replace("-USD", "")}</b><span className="muted"> /USD</span></td>
                  <td>{TYPE_LABEL[x.class] ?? x.class}</td>
                  <td>{x.class === "crypto" ? <span className="muted">24/7</span> : <SessionChip s={x.sessionState.underlying} />}</td>
                  <td className="muted">{x.class === "crypto" || x.sessionState.underlying === "open" ? "—" : when(x.sessionState.nextOpen)}</td>
                  <td className="num">{fmt(x.stats.markPrice)}</td>
                  <td className={`num chg ${Number(x.stats.priceChangePct24h) >= 0 ? "up" : "dn"}`}>{Number(x.stats.priceChangePct24h) >= 0 ? "+" : ""}{Number(x.stats.priceChangePct24h).toFixed(2)}%</td>
                  <td className="num">{(Number(x.stats.fundingRateHourly) * 100).toFixed(4)}%</td>
                  <td className="num">${fmt(x.stats.openInterest, 0)}</td>
                  <td className="num">${fmt(x.stats.volume24h, 0)}</td>
                  <td>{x.notes.length > 0 && <span className="chip note" title={x.notes.map(noteText).join("\n")}>ⓘ {x.notes.length}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {m.loading && !m.data && <p className="loading">Loading live markets…</p>}
        {m.data && rows.length === 0 && <p className="muted">No markets match.</p>}
        <p className="basis">Prices refresh every 15 s from Strike. Hover the ⓘ chips for notes on a market.</p>
      </div>
    </>
  );
}
