import { type ReactNode, useEffect, useMemo, useState } from "react";
import { type CircuitReport, type GapRow, type LiqCheck, type LogEntry, type MarketRecord, type Status, api } from "./api";
import { BandPill, ModeBadge, RULE_EXPLAIN, RULE_TITLE, SessionChip, Spark, Term, fmt, logSentence, logTitle, plainVerdict, pct, usd } from "./ui";

function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

function Pill({ kind, children }: { kind: "live" | "ok" | "warn" | "muted"; children: ReactNode }) {
  return <span className={`pill ${kind}`}>{kind === "live" && <span className="pulse" />}{children}</span>;
}

const coin = (s: string) => s.replace("-USD", "");

export function Overview({ status, go }: { status: Status | null; go: (p: string) => void }) {
  const [markets, setMarkets] = useState<{ list: MarketRecord[]; at: number } | null>(null);
  const [liq, setLiq] = useState<LiqCheck | null>(null);
  const [gaps, setGaps] = useState<GapRow[] | null>(null);
  const [sparks, setSparks] = useState<Record<string, string[]>>({});
  const [demo, setDemo] = useState<CircuitReport | null>(null);
  const [log, setLog] = useState<{ entries: LogEntry[]; ok: boolean | null; n: number }>({ entries: [], ok: null, n: 0 });
  const [, tick] = useState(0);

  useEffect(() => {
    const loadMarkets = () => api.markets().then((r) => setMarkets({ list: r.markets, at: Date.now() }), () => undefined);
    void loadMarkets();
    const t = setInterval(loadMarkets, 15_000);
    const c = setInterval(() => tick((x) => x + 1), 1000);
    api.liqCheck().then(setLiq, () => undefined);
    api.gapStats().then((g) => {
      setGaps(g);
      const top = [...g].filter((x) => x.pMove5Long !== null).sort((a, b) => Number(b.pMove5Long) - Number(a.pMove5Long)).slice(0, 8);
      void Promise.all(top.map((x) => api.history(x.symbol).then((h) => [x.symbol, h.closes] as const, () => [x.symbol, []] as const))).then((pairs) => setSparks(Object.fromEntries(pairs)));
    }, () => undefined);
    api.simulate({ symbol: "NVDA-USD", side: "buy", notionalUsd: "1000", leverage: 10, orderType: "market", source: "none", log: false }).then(setDemo, () => undefined);
    Promise.all([api.log(6), api.verify()]).then(([l, v]) => setLog({ entries: l.entries, ok: v.ok, n: v.entries }), () => undefined);
    return () => { clearInterval(t); clearInterval(c); };
  }, []);

  const k = useMemo(() => {
    const ms = markets?.list ?? [];
    const tradfi = ms.filter((m) => m.class !== "crypto");
    const closed = tradfi.filter((m) => m.sessionState.underlying !== "open");
    const nextOpen = closed.map((m) => m.sessionState.nextOpen).filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null;
    return { total: ms.length, tradfi: tradfi.length, closed: closed.length, nextOpen };
  }, [markets]);

  const ranked = useMemo(() => (gaps ?? []).filter((g) => g.pMove5Long !== null).sort((a, b) => Number(b.pMove5Long) - Number(a.pMove5Long)).slice(0, 8), [gaps]);
  const maxP = Math.max(1, ...ranked.map((g) => Number(g.pMove5Long)));
  const alt = demo?.alternativeReport;

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Apex · risk desk for Strike Finance</p>
          <h1 className="hero-title">Know your risk before you trade, and before the weekend.</h1>
          <p className="hero-sub">
            Stock and index perps on Strike trade all weekend, while the real market is closed. A <Term k="gap">gap</Term> at the reopen can <Term k="liquidation">liquidate</Term> you with no warning.
            Apex measures that risk from Strike's own price history, blocks trades that break your limits, and only acts when you confirm.
          </p>
          <div className="pills">
            <Pill kind="live">Live from Strike {status?.env ?? "mainnet"}{markets ? ` · ${ago(markets.at)}` : ""}</Pill>
            <Pill kind={log.ok === null ? "muted" : log.ok ? "ok" : "warn"}>{log.ok === null ? "Checking audit log…" : log.ok ? `✓ Audit log intact · ${log.n} entries` : "✕ Audit log check failed"}</Pill>
            <Pill kind="muted">{status?.mode === "live" ? "Real trading enabled" : "Paper mode · no real orders are sent"}</Pill>
          </div>
        </div>
      </section>

      <section className="steps" aria-label="How Apex works">
        <button className="step" onClick={() => go("positions")}>
          <span className="step-n">1</span><b>See the risk</b>
          <span>Live prices and the chance of a weekend gap for every market on Strike.</span>
          <span className="step-go">Open Weekend risk →</span>
        </button>
        <button className="step" onClick={() => go("circuit")}>
          <span className="step-n">2</span><b>Check before you trade</b>
          <span>Test any trade first. Apex blocks it if it breaks your limits and suggests a safer size.</span>
          <span className="step-go">Check a trade →</span>
        </button>
        <button className="step" onClick={() => go("log")}>
          <span className="step-n">3</span><b>Protect, with your OK</b>
          <span>Add a stop-loss in two clicks. Nothing moves until you confirm, and every step is recorded and signed.</span>
          <span className="step-go">See the Audit log →</span>
        </button>
      </section>

      <p className="legend-line">
        <b>Labels:</b> <span className="lbl">LIVE</span> straight from Strike · <span className="lbl">ESTIMATE</span> calculated by Apex · <span className="lbl">SCENARIO</span> a what-if · <span className="lbl">PAPER</span> simulated account. Hover dotted words for definitions, or open the Glossary.
      </p>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <button className="card kpi clickable" onClick={() => go("radar")}>
          <div className="k">Markets tracked <span className="lbl">LIVE</span></div>
          <div className="v">{k.total || "—"}</div>
          <div className="k">crypto, stocks, indices and commodities</div>
        </button>
        <button className="card kpi clickable" onClick={() => go("positions")}>
          <div className="k">Stock & index perps trading without their real market</div>
          <div className="v" style={{ color: "var(--warn)" }}>{k.closed} <span className="v-sub">of {k.tradfi}</span></div>
          <div className="k">{k.nextOpen ? `first reopen ${new Date(k.nextOpen).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "—"}</div>
        </button>
        <div className="card kpi">
          <div className="k">Apex's liquidation math vs Strike's <span className="lbl">LIVE</span></div>
          <div className="v" style={{ color: liq && liq.matched === liq.total ? "var(--ok)" : "var(--text)" }}>{liq ? `${liq.matched} of ${liq.total}` : "…"}</div>
          <div className="k">{liq ? `real positions match (largest gap ${liq.maxDiffPct}%)` : "checking real positions…"}</div>
        </div>
        <button className="card kpi clickable" onClick={() => go("log")}>
          <div className="k">Entries in the audit log</div>
          <div className="v">{log.n || "—"}</div>
          <div className="k">each one hashed and signed</div>
        </button>
      </div>

      <div className="grid ov-2">
        <div className="card">
          <div className="card-head">
            <h2>Which markets are most exposed to a weekend gap?</h2>
            <button className="link" onClick={() => go("positions")}>Full table →</button>
          </div>
          <p className="muted" style={{ marginTop: -4 }}>The chance that a long position loses 5% or more between the real market's close and its next open. Longer bar = riskier.</p>
          {!gaps && <p className="loading">Reading Strike's hourly price history for every stock and index market…</p>}
          <div className="bars">
            {ranked.map((g) => (
              <div key={g.symbol} className="bar-row">
                <div className="bar-sym"><b>{coin(g.symbol)}</b><SessionChip s={g.underlying} /></div>
                <div className="bar-track">
                  <div className={`bar-fill ${g.method}`} style={{ width: `${(Number(g.pMove5Long) / maxP) * 100}%` }} />
                  <span className="bar-val">{Number(g.pMove5Long).toFixed(1)}%</span>
                </div>
                <div className="bar-meta">{g.method === "EMPIRICAL" ? `${g.samples} real gaps` : "modeled"}</div>
                <div className="bar-spark">{sparks[g.symbol] ? <Spark closes={sparks[g.symbol]!} /> : null}</div>
              </div>
            ))}
          </div>
          {gaps && <p className="basis">Solid bars use real past gaps; striped bars are <Term k="modeled">modeled</Term> (hours unknown or short history). The small line is the last 4 days of price.</p>}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>See it work: a $1,000 NVDA trade at 10x</h2>
            <button className="link" onClick={() => go("circuit")}>Try your own →</button>
          </div>
          <p className="muted" style={{ marginTop: -4 }}>A real check on live prices <ModeBadge mode="SCENARIO" /> Nothing is sent to Strike.</p>
          {!demo && <p className="loading">Reading the live order book…</p>}
          {demo && (
            <>
              <div className={`vhero ${demo.verdict.decision === "APPROVE" ? "ok" : "bad"} compact`}>
                <div className="vicon" aria-hidden="true">{demo.verdict.decision === "APPROVE" ? "✓" : "✕"}</div>
                <div>
                  <div className="vtitle">{demo.verdict.decision === "APPROVE" ? "Allowed" : `Blocked — breaks ${demo.verdict.violations.length} safety rules`}</div>
                  <ul className="reasons">{plainVerdict(demo.verdict).slice(0, 4).map((x) => <li key={x.id}><b>{x.title}.</b> {x.message}</li>)}</ul>
                </div>
              </div>
              {alt && (
                <table className="cmp">
                  <thead><tr><th></th><th>You asked for</th><th className="ok-t">Apex's safer version</th></tr></thead>
                  <tbody>
                    <tr><td>Size</td><td>{fmt(demo.size.value, 2)} NVDA at {demo.leverage}x</td><td><b>{fmt(alt.size.value, 2)} NVDA at {alt.leverage}x</b></td></tr>
                    <tr><td>Position size</td><td>{usd(demo.notionalUsd.value, 0)}</td><td><b>{usd(alt.notionalUsd.value, 0)}</b></td></tr>
                    <tr><td>Liquidation is</td><td className="bad-t">{pct(demo.liquidation.distancePct.value, 1)} away</td><td className="ok-t"><b>{pct(alt.liquidation.distancePct.value, 1)} away</b></td></tr>
                    <tr><td>Referee says</td><td className="bad-t">Blocked</td><td className="ok-t"><b>Allowed</b></td></tr>
                  </tbody>
                </table>
              )}
              {demo.weekend.gap?.pGap != null && <p className="basis">Weekend gap chance for the safer version is {alt?.weekend.gap?.pGap ?? demo.weekend.gap.pGap}% <BandPill band={alt?.weekend.gap?.band ?? demo.weekend.gap.band} />, from {demo.weekend.gap.samples} real past gaps.</p>}
            </>
          )}
        </div>
      </div>

      <div className="grid ov-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Proof: Apex's liquidation prices match Strike's <span className="lbl">LIVE</span></h2>
          <p className="muted" style={{ marginTop: -4 }}>Apex recomputes each liquidation price from Strike's margin rules and compares it with what Strike reports{liq ? ` (${liq.source})` : ""}. Close to zero difference means you can trust the numbers.</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Market</th><th className="num">Apex says</th><th className="num">Strike says</th><th className="num">Difference</th><th></th></tr></thead>
              <tbody>
                {(liq?.checks ?? []).filter((c) => c.diffPct !== null).slice(0, 7).map((c) => (
                  <tr key={c.symbol}><td><b>{coin(c.symbol)}</b></td><td className="num">{Number(c.computed).toPrecision(8)}</td><td className="num">{Number(c.served).toPrecision(8)}</td><td className="num">{Number(c.diffPct) < 0.0001 ? "< 0.0001%" : `${c.diffPct}%`}</td><td>{c.match ? <span className="ok-t">✓ match</span> : <span className="bad-t">✕</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {!liq && <p className="loading">Reading positions…</p>}
          {liq && <p className="basis">{liq.matched} of {liq.total} positions are within 1% of Strike's own number.</p>}
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <div className="card">
            <h2>The 12 safety checks every action must pass</h2>
            <p className="muted" style={{ marginTop: -4 }}>The <Term k="referee">Risk Referee</Term> is fixed code with no AI in the loop. If any check fails, nothing is sent.</p>
            <div className="rules">
              {Object.keys(RULE_TITLE).map((id) => <div key={id} className="rule" title={RULE_EXPLAIN[id]}><span className="rule-chip">{id}</span><span>{RULE_TITLE[id]}</span></div>)}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Latest in the audit log</h2><button className="link" onClick={() => go("log")}>All entries →</button></div>
            {log.entries.map((e) => (
              <div key={e.seq} className="feed2"><span className="mono muted">#{e.seq}</span><span className="clamp2"><b>{logTitle(e.type)}</b> <span className="muted">· {logSentence(e)}</span></span><span className="muted">{new Date(e.ts).toLocaleTimeString()}</span></div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
