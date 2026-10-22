import { type ReactNode, useEffect, useMemo, useState } from "react";
import { type CircuitReport, type GapRow, type LiqCheck, type LogEntry, type MarketRecord, type Status, api } from "./api";

const RULES: Array<[string, string]> = [
  ["R1", "Leverage cap (lower while the underlying is closed)"],
  ["R2", "Position notional"],
  ["R3", "Portfolio notional"],
  ["R4", "Single-market concentration"],
  ["R5", "Liquidation distance"],
  ["R6", "Allowed class & symbol"],
  ["R7", "Market ACTIVE"],
  ["R8", "Fresh data (mark 15 s · depth 10 s)"],
  ["R9", "Action rate"],
  ["R10", "Tick, step, min qty, min notional"],
  ["R11", "Protective orders reduce-only, no instant trigger"],
  ["R12", "PAPER default · LIVE needs env + human confirm"],
];

function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

function Spark({ closes, w = 120, h = 28 }: { closes: string[]; w?: number; h?: number }) {
  const v = closes.map(Number).filter(Number.isFinite);
  if (v.length < 2) return <svg width={w} height={h} />;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - lo) / span) * (h - 4)).toFixed(1)}`).join(" ");
  const up = v[v.length - 1]! >= v[0]!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="spark" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? "var(--ok)" : "var(--danger)"} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Pill({ kind, children }: { kind: "live" | "ok" | "warn" | "muted"; children: ReactNode }) {
  return <span className={`pill ${kind}`}>{kind === "live" && <span className="pulse" />}{children}</span>;
}

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
      const top = [...g].filter((x) => x.pMove5Long !== null).sort((a, b) => Number(b.pMove5Long) - Number(a.pMove5Long)).slice(0, 10);
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
    return { total: ms.length, crypto: ms.length - tradfi.length, tradfi: tradfi.length, closed: closed.length, nextOpen };
  }, [markets]);

  const ranked = useMemo(() => (gaps ?? []).filter((g) => g.pMove5Long !== null).sort((a, b) => Number(b.pMove5Long) - Number(a.pMove5Long)).slice(0, 10), [gaps]);
  const maxP = Math.max(1, ...ranked.map((g) => Number(g.pMove5Long)));

  return (
    <>
      <section className="hero">
        <div>
          <h1 className="hero-title">The risk desk that watches Strike while the stock market sleeps</h1>
          <p className="sub" style={{ margin: "6px 0 0" }}>Everything on this page is computed right now from Strike mainnet. Nothing is mocked.</p>
        </div>
        <div className="pills">
          <Pill kind="live">LIVE · Strike {status?.env ?? "mainnet"}{markets ? ` · updated ${ago(markets.at)}` : ""}</Pill>
          <Pill kind={log.ok === null ? "muted" : log.ok ? "ok" : "warn"}>{log.ok === null ? "verifying log…" : log.ok ? `✓ decision log verified · ${log.n} entries` : "✗ log verification failed"}</Pill>
          <Pill kind="muted">{status?.mode === "live" ? "LIVE trading enabled" : "PAPER mode · no real orders"}</Pill>
        </div>
      </section>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <button className="card kpi clickable" onClick={() => go("radar")}>
          <div className="k">Markets streaming <span className="lbl">LIVE</span></div>
          <div className="v">{k.total || "—"}</div>
          <div className="k">{k.crypto} crypto · {k.tradfi} stocks, indices, commodities</div>
        </button>
        <button className="card kpi clickable" onClick={() => go("positions")}>
          <div className="k">Underlying market closed now</div>
          <div className="v" style={{ color: "var(--warn)" }}>{k.closed} <span className="v-sub">of {k.tradfi}</span></div>
          <div className="k">{k.nextOpen ? `next open ${new Date(k.nextOpen).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "—"}</div>
        </button>
        <div className="card kpi">
          <div className="k">Liquidation math vs Strike <span className="lbl">LIVE</span></div>
          <div className="v" style={{ color: liq && liq.matched === liq.total ? "var(--ok)" : "var(--text)" }}>{liq ? `${liq.matched}/${liq.total}` : "…"}</div>
          <div className="k">{liq ? `real positions match · max diff ${liq.maxDiffPct}%` : "checking real positions…"}</div>
        </div>
        <button className="card kpi clickable" onClick={() => go("log")}>
          <div className="k">Signed decisions</div>
          <div className="v">{log.n || "—"}</div>
          <div className="k">hash-chained · Ed25519 · {log.ok ? "intact" : "…"}</div>
        </button>
      </div>

      <div className="grid ov-2">
        <div className="card">
          <div className="card-head">
            <h2>Weekend gap risk, right now <span className="lbl">ESTIMATE</span></h2>
            <button className="link" onClick={() => go("positions")}>Weekend Shield →</button>
          </div>
          <p className="muted" style={{ marginTop: -4 }}>Chance that a long loses ≥ 5% between the underlying's close and its next open, from Strike's own hourly mark history.</p>
          {!gaps && <p className="loading">Reading 1h mark history for every TradFi market…</p>}
          <div className="bars">
            {ranked.map((g) => (
              <div key={g.symbol} className="bar-row">
                <div className="bar-sym"><b>{g.symbol.replace("-USD", "")}</b><span className={`chip ${g.underlying}`}>{g.underlying}</span></div>
                <div className="bar-track">
                  <div className={`bar-fill ${g.method}`} style={{ width: `${(Number(g.pMove5Long) / maxP) * 100}%` }} />
                  <span className="bar-val">{Number(g.pMove5Long).toFixed(1)}%</span>
                </div>
                <div className="bar-meta">{g.method === "EMPIRICAL" ? `${g.samples} real gaps` : "modeled"}</div>
                <div className="bar-spark">{sparks[g.symbol] ? <Spark closes={sparks[g.symbol]!} /> : null}</div>
              </div>
            ))}
          </div>
          {gaps && <p className="basis">Solid = empirical close→open moves · striped = modeled (session unknown or short history). Sparkline = last 96 h of mark.</p>}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Circuit, live <span className="lbl">SCENARIO</span></h2>
            <button className="link" onClick={() => go("circuit")}>Open Circuit →</button>
          </div>
          <p className="muted" style={{ marginTop: -4 }}>"Simulate a $1,000 NVDA long at 10x." Nothing is sent to Strike.</p>
          {!demo && <p className="loading">Walking the live order book…</p>}
          {demo && (
            <>
              <div className={`verdict ${demo.verdict.decision}`}>
                <div className="t">Risk Referee: {demo.verdict.decision}</div>
                <div className="rule-chips">{demo.verdict.violations.map((v) => <span key={v.id} className="rule-chip bad" title={v.message}>{v.id}</span>)}</div>
                <ul>{demo.verdict.violations.slice(0, 4).map((v) => <li key={v.id}><b>{v.id}</b> {v.message}</li>)}</ul>
              </div>
              <div className="compare">
                <div>
                  <div className="cmp-h">Requested</div>
                  <div className="cmp-row"><span>Size</span><b>{demo.size.value} @ {demo.leverage}x</b></div>
                  <div className="cmp-row"><span>Notional</span><b>${Number(demo.notionalUsd.value).toFixed(0)}</b></div>
                  <div className="cmp-row"><span>Liquidation</span><b className="bad-t">{Number(demo.liquidation.distancePct.value).toFixed(1)}% away</b></div>
                  <div className="cmp-row"><span>Weekend p_gap</span><b>{demo.weekend.gap?.pGap ?? "—"}%</b></div>
                </div>
                <div className="cmp-arrow">→</div>
                <div>
                  <div className="cmp-h ok-t">Compliant alternative</div>
                  {demo.alternativeReport ? (
                    <>
                      <div className="cmp-row"><span>Size</span><b>{demo.alternativeReport.size.value} @ {demo.alternativeReport.leverage}x</b></div>
                      <div className="cmp-row"><span>Notional</span><b>${Number(demo.alternativeReport.notionalUsd.value).toFixed(0)}</b></div>
                      <div className="cmp-row"><span>Liquidation</span><b className="ok-t">{Number(demo.alternativeReport.liquidation.distancePct.value).toFixed(1)}% away</b></div>
                      <div className="cmp-row"><span>Referee</span><b className="ok-t">{demo.alternativeReport.verdict.decision}</b></div>
                    </>
                  ) : <p className="muted">none</p>}
                </div>
              </div>
              <p className="basis">Entry {demo.entryPrice.value} from a {demo.slippage.levelsUsed}-level depth walk ({demo.slippage.slippageBpsVsMark.value} bps); liquidation from Strike's margin-tier formula; underlying {demo.weekend.underlying}.</p>
            </>
          )}
        </div>
      </div>

      <div className="grid ov-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Proof: Apex's liquidation price vs Strike's <span className="lbl">LIVE</span></h2>
          <p className="muted" style={{ marginTop: -4 }}>Apex recomputes every liquidation price from Strike's margin tiers and compares it with what Strike reports{liq ? ` (${liq.source})` : ""}.</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Market</th><th className="num">Apex</th><th className="num">Strike</th><th className="num">Diff</th><th></th></tr></thead>
              <tbody>
                {(liq?.checks ?? []).filter((c) => c.diffPct !== null).slice(0, 8).map((c) => (
                  <tr key={c.symbol}><td><b>{c.symbol}</b></td><td className="num">{Number(c.computed).toPrecision(8)}</td><td className="num">{Number(c.served).toPrecision(8)}</td><td className="num">{Number(c.diffPct) < 0.0001 ? "<0.0001%" : `${c.diffPct}%`}</td><td>{c.match ? <span className="ok-t">✓</span> : <span className="bad-t">✗</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {!liq && <p className="loading">Reading positions…</p>}
          {liq && <p className="basis">{liq.matched}/{liq.total} positions within 1% (positions with no liquidation price count as matches when both are 0).</p>}
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <div className="card">
            <h2>Risk Referee · 12 rules, deterministic</h2>
            <div className="rules">{RULES.map(([id, t]) => <div key={id} className="rule"><span className="rule-chip">{id}</span><span>{t}</span></div>)}</div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Latest decisions</h2><button className="link" onClick={() => go("log")}>Decision log →</button></div>
            {log.entries.map((e) => (
              <div key={e.seq} className="feed"><span className="mono muted">#{e.seq}</span><b>{e.type.replace(/_/g, " ")}</b><span className={`badge ${e.mode === "live" ? "LIVE" : e.mode === "paper" ? "PAPER" : "SCENARIO"}`}>{e.mode.toUpperCase()}</span><span className="muted">{new Date(e.ts).toLocaleTimeString()}</span></div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
