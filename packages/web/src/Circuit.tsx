import { useState } from "react";
import { type CircuitReport, type MarketRecord, type Source, type Status, api } from "./api";
import { BandPill, Lbl, ModeBadge, PageHead, SessionChip, Term, fmt, pct, plainVerdict, usd, useAsync } from "./ui";

interface Form { symbol: string; side: "buy" | "sell"; notionalUsd: string; leverage: string; stopLoss: string; takeProfit: string; account: string }

const PRESETS: Array<{ label: string; hint: string; f: Partial<Form> }> = [
  { label: "The risky one", hint: "$1,000 NVDA long at 10x", f: { symbol: "NVDA-USD", side: "buy", notionalUsd: "1000", leverage: "10" } },
  { label: "A safer one", hint: "$400 BTC long at 3x", f: { symbol: "BTC-USD", side: "buy", notionalUsd: "400", leverage: "3" } },
  { label: "Short a stock", hint: "$300 TSLA short at 5x", f: { symbol: "TSLA-USD", side: "sell", notionalUsd: "300", leverage: "5" } },
];

const dirWord = (s: string) => (s === "buy" ? "long" : "short");
const coin = (s: string) => s.replace("-USD", "");

function Facts({ r }: { r: CircuitReport }) {
  const liq = r.liquidation.price.value;
  const noLiq = liq === null || liq.startsWith("0");
  const dist = r.liquidation.distancePct.value;
  const danger = dist !== null && Number(dist) < 15;
  const g = r.weekend.gap;
  return (
    <div className="facts">
      <div className="fact">
        <div className="fact-k"><Term k="liquidation">Liquidation</Term> <Lbl l="ESTIMATE" /></div>
        {noLiq ? <div className="fact-v ok-t">No liquidation price</div> : (
          <>
            <div className={`fact-v ${danger ? "bad-t" : "ok-t"}`}>{pct(dist, 1)} away</div>
            <div className="fact-s">You'd be liquidated if {coin(r.symbol)} {r.side === "buy" ? "falls" : "rises"} to <b>${fmt(liq)}</b> (now ${fmt(r.markPrice.value)}).</div>
          </>
        )}
      </div>
      <div className="fact">
        <div className="fact-k"><Term k="gapchance">Weekend gap chance</Term> <Lbl l="ESTIMATE" /></div>
        {g && g.pGap !== null ? (
          <>
            <div className="fact-v"><BandPill band={g.band}>{g.band}</BandPill> {g.pGap}%</div>
            <div className="fact-s">Chance a closed-market move alone reaches that price. Based on {g.method === "EMPIRICAL" ? `${g.samples} real past gaps` : "a modeled estimate"}. Market is <SessionChip s={r.weekend.underlying} /></div>
          </>
        ) : <div className="fact-s">Not applicable: crypto has no closed-market gap.</div>}
      </div>
      <div className="fact">
        <div className="fact-k">What it costs <Lbl l="ESTIMATE" /></div>
        <div className="fact-v">{usd(r.fees.openCostUsd.value, 2)} <span className="fact-u">to open</span></div>
        <div className="fact-s"><Term k="slippage">Slippage</Term> {fmt(r.slippage.slippageBpsVsMark.value)} bps · <Term k="funding">funding</Term> {usd(r.funding.costPer24hUsd.value, 3)}/day</div>
      </div>
    </div>
  );
}

function Details({ r }: { r: CircuitReport }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginTop: 12 }}>
      <div className="card">
        <h2>Execution</h2>
        <dl className="kv">
          <dt>Price now</dt><dd>{fmt(r.markPrice.value)} <Lbl l="LIVE" /></dd>
          <dt>Estimated entry</dt><dd>{fmt(r.entryPrice.value)}</dd>
          <dt>Slippage</dt><dd>{fmt(r.slippage.slippageBpsVsMark.value)} bps{r.slippage.insufficientDepth && <span className="err"> not enough depth</span>}</dd>
          <dt>Fee to open</dt><dd>{usd(r.fees.openCostUsd.value, 4)}</dd>
          <dt>Fee to close</dt><dd>{usd(r.fees.closeCostUsd.value, 4)}</dd>
          <dt>Funding per day</dt><dd>{usd(r.funding.costPer24hUsd.value, 4)}</dd>
        </dl>
        <p className="basis">{r.liquidation.basis}. {r.fees.tierNote}</p>
      </div>
      <div className="card">
        <h2>If the price moves against you <Lbl l="SCENARIO" /></h2>
        <table>
          <thead><tr><th>Move</th><th className="num">Price</th><th className="num">Profit / loss</th><th></th></tr></thead>
          <tbody>{r.stress.map((s) => <tr key={s.movePct}><td>−{s.movePct}%</td><td className="num">{fmt(s.price.value)}</td><td className="num">{usd(s.pnlUsd.value)}</td><td>{s.liquidated && <span className="chip flag">LIQUIDATED</span>}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="card">
        <h2>Effect on your portfolio</h2>
        <dl className="kv">
          <dt>Total position size</dt><dd>{usd(r.portfolio.before.totalNotionalUsd.value, 0)} → {usd(r.portfolio.after.totalNotionalUsd.value, 0)}</dd>
          <dt>Share in this market</dt><dd>{pct(r.portfolio.before.concentrationPct.value, 0)} → {pct(r.portfolio.after.concentrationPct.value, 0)}</dd>
          <dt>Margin in use</dt><dd>{pct(r.portfolio.before.marginUtilizationPct.value, 0)} → {pct(r.portfolio.after.marginUtilizationPct.value, 0)}</dd>
        </dl>
        <p className="basis">{r.portfolio.accountSource}</p>
      </div>
      {r.riskReward && (
        <div className="card">
          <h2>Risk vs reward</h2>
          <dl className="kv"><dt>Loss at stop</dt><dd>{usd(r.riskReward.lossUsd.value)}</dd><dt>Gain at target</dt><dd>{usd(r.riskReward.gainUsd.value)}</dd><dt>Ratio</dt><dd>{fmt(r.riskReward.ratio.value)}</dd></dl>
        </div>
      )}
    </div>
  );
}

function Verdict({ r }: { r: CircuitReport }) {
  const ok = r.verdict.decision === "APPROVE";
  const reasons = plainVerdict(r.verdict);
  return (
    <div className={`vhero ${ok ? "ok" : "bad"}`}>
      <div className="vicon" aria-hidden="true">{ok ? "✓" : "✕"}</div>
      <div>
        <div className="vtitle">{ok ? "Allowed — it passes all 12 safety checks" : `Blocked — it breaks ${reasons.length} safety ${reasons.length === 1 ? "rule" : "rules"}`}</div>
        <div className="vsub">{ok ? "Nothing is sent anywhere. This was a check only." : <>The <Term k="referee">Risk Referee</Term> would refuse this trade. Nothing was sent to Strike.</>}</div>
        {!ok && (
          <ul className="reasons">
            {reasons.map((x) => <li key={x.id}><b>{x.title}.</b> {x.message}</li>)}
          </ul>
        )}
        {r.stale.stale && <p className="err">Stale data: {r.stale.reasons.join("; ")}</p>}
        {r.exchangeWarnings.map((w) => <p key={w} className="err">{w}</p>)}
      </div>
    </div>
  );
}

function Alternative({ r, alt }: { r: CircuitReport; alt: CircuitReport }) {
  const rows: Array<[string, string, string]> = [
    ["Size", `${fmt(r.size.value, 4)} ${coin(r.symbol)}`, `${fmt(alt.size.value, 4)} ${coin(alt.symbol)}`],
    ["Leverage", `${r.leverage}x`, `${alt.leverage}x`],
    ["Position size", usd(r.notionalUsd.value, 0), usd(alt.notionalUsd.value, 0)],
    ["Liquidation", `${pct(r.liquidation.distancePct.value, 1)} away`, `${pct(alt.liquidation.distancePct.value, 1)} away`],
    ["Weekend gap chance", r.weekend.gap?.pGap != null ? `${r.weekend.gap.pGap}%` : "—", alt.weekend.gap?.pGap != null ? `${alt.weekend.gap.pGap}%` : "—"],
    ["Referee", r.verdict.decision === "APPROVE" ? "Allowed" : "Blocked", alt.verdict.decision === "APPROVE" ? "Allowed" : "Blocked"],
  ];
  return (
    <div className="card alt">
      <h2>Apex's safer version</h2>
      <p className="muted" style={{ marginTop: -6 }}>The largest trade in the same direction that passes every rule: {dirWord(alt.side)} <b>{fmt(alt.size.value, 4)} {coin(alt.symbol)}</b> at <b>{alt.leverage}x</b>.</p>
      <table className="cmp">
        <thead><tr><th></th><th>You asked for</th><th className="ok-t">Safer version</th></tr></thead>
        <tbody>{rows.map(([k, a, b]) => <tr key={k}><td>{k}</td><td className={k === "Referee" && a === "Blocked" ? "bad-t" : ""}>{a}</td><td className={k === "Referee" ? "ok-t" : ""}><b>{b}</b></td></tr>)}</tbody>
      </table>
    </div>
  );
}

export function Circuit({ source: defaultSource, status }: { source: Source; status: Status | null }) {
  const [f, setF] = useState<Form>({ symbol: "NVDA-USD", side: "buy", notionalUsd: "1000", leverage: "10", stopLoss: "", takeProfit: "", account: "none" });
  const [r, setR] = useState<CircuitReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const markets = useAsync(() => api.markets(), []);
  const source = f.account === "default" ? defaultSource : f.account;
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const run = async (form: Form = f) => {
    setBusy(true);
    setErr(null);
    try {
      const src = form.account === "default" ? defaultSource : form.account;
      setR(await api.simulate({ symbol: form.symbol, side: form.side, notionalUsd: form.notionalUsd, leverage: Number(form.leverage), orderType: "market", ...(form.stopLoss ? { stopLoss: form.stopLoss } : {}), ...(form.takeProfit ? { takeProfit: form.takeProfit } : {}), source: src }));
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };
  const preset = (p: Partial<Form>) => {
    const next = { ...f, ...p };
    setF(next);
    void run(next);
  };
  void source;

  const list: MarketRecord[] = markets.data?.markets ?? [];
  const group = (cls: string) => list.filter((m) => m.class === cls);
  return (
    <>
      <PageHead
        title="Check a trade"
        badge={<ModeBadge mode="SCENARIO" />}
        what={<>Type a trade and Apex tells you, in seconds, whether it is safe — <b>before you place it</b>. It shows where you'd be <Term k="liquidation">liquidated</Term>, what it costs, and whether it breaks your safety rules. Nothing is sent to Strike.</>}
        tip="click one of the examples below."
      />
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.label} className="preset" onClick={() => preset(p.f)} disabled={busy}>
            <b>{p.label}</b><span>{p.hint}</span>
          </button>
        ))}
      </div>
      <div className="grid cols-2">
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <h2>Your trade</h2>
          <label>Market
            <select value={f.symbol} onChange={set("symbol")}>
              {list.length === 0 && <option>{f.symbol}</option>}
              {(["equity", "index", "commodity", "crypto"] as const).map((c) => group(c).length > 0 && (
                <optgroup key={c} label={c === "equity" ? "Stocks" : c === "index" ? "Indices" : c === "commodity" ? "Commodities" : "Crypto"}>
                  {group(c).map((m) => <option key={m.symbol} value={m.symbol}>{m.symbol.replace("-USD", "")}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <div>
            <div className="lab">Direction</div>
            <div className="seg" role="group" aria-label="Direction">
              <button type="button" className={f.side === "buy" ? "on up" : ""} onClick={() => setF({ ...f, side: "buy" })}>Long — profit if it rises</button>
              <button type="button" className={f.side === "sell" ? "on dn" : ""} onClick={() => setF({ ...f, side: "sell" })}>Short — profit if it falls</button>
            </div>
          </div>
          <label>Amount (US dollars)<input inputMode="decimal" value={f.notionalUsd} onChange={set("notionalUsd")} /></label>
          <label><span><Term k="leverage">Leverage</Term>: <b>{f.leverage}x</b></span>
            <input type="range" min={1} max={20} value={Number(f.leverage) || 1} onChange={set("leverage")} />
          </label>
          <details className="adv">
            <summary>Advanced options</summary>
            <div className="row2" style={{ marginTop: 10 }}>
              <label><Term k="stop">Stop-loss</Term> price<input inputMode="decimal" value={f.stopLoss} onChange={set("stopLoss")} placeholder="optional" /></label>
              <label>Take-profit price<input inputMode="decimal" value={f.takeProfit} onChange={set("takeProfit")} placeholder="optional" /></label>
            </div>
            <label style={{ marginTop: 10 }}>Include existing positions from
              <select value={f.account} onChange={set("account")}>
                <option value="none">None — a fresh trade</option>
                <option value="paper">The Apex paper account</option>
                {status?.hasKeys && <option value="own">My Strike account</option>}
              </select>
            </label>
          </details>
          <button className="btn big" disabled={busy}>{busy ? "Checking…" : "Check this trade"}</button>
          {err && <p className="err">{err}</p>}
        </form>
        <div className="result">
          {!r && !busy && <div className="card empty"><div className="empty-ic">⚖️</div><b>Your result appears here.</b><p className="muted">Pick an example above, or set up your own trade and press <b>Check this trade</b>.</p></div>}
          {busy && <div className="card loading">Reading the live order book, margin tiers and price history…</div>}
          {r && !busy && (
            <>
              <h2 className="rtitle">{dirWord(r.side) === "long" ? "Long" : "Short"} {coin(r.symbol)} · {usd(r.notionalUsd.value, 0)} · {r.leverage}x</h2>
              <Verdict r={r} />
              <Facts r={r} />
              {r.alternativeReport && <Alternative r={r} alt={r.alternativeReport} />}
              <details className="adv more">
                <summary>Show every number behind this</summary>
                <Details r={r} />
              </details>
            </>
          )}
        </div>
      </div>
    </>
  );
}
