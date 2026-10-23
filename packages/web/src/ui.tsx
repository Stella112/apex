import { type ReactNode, type SyntheticEvent, useCallback, useEffect, useState } from "react";
import type { LogEntry, Verdict } from "./api";

// ── formatting ───────────────────────────────────────────────────────────────
export const fmt = (v: string | null | undefined, dp = 2) => {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const a = Math.abs(n);
  const d = a >= 1000 ? 2 : a >= 1 ? dp : a >= 0.01 ? 4 : 8;
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
};
export const pct = (v: string | null | undefined, dp = 2) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(dp)}%`);
export const usd = (v: string | null | undefined, dp = 2) => (v === null || v === undefined ? "—" : `$${fmt(v, dp)}`);
export const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
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

// ── words ────────────────────────────────────────────────────────────────────
export const GLOSSARY: Record<string, { term: string; text: string }> = {
  perp: { term: "Perp", text: "A perpetual future: a contract that tracks a price and never expires. Strike lists crypto, stocks, indices and commodities as perps." },
  liquidation: { term: "Liquidation", text: "When losses use up the margin backing a trade, Strike closes it automatically and you lose that margin." },
  leverage: { term: "Leverage", text: "Borrowed exposure. At 10x, a 10% move against you can wipe out your margin." },
  session: { term: "Real market", text: "The stock, index or commodity market behind a perp. The perp trades 24/7 even when the real market is closed." },
  gap: { term: "Weekend gap", text: "A jump in price between the real market's close and its next open. Perps keep trading in between, so the move can liquidate you." },
  gapchance: { term: "Gap chance", text: "The chance that a closed-market move alone is big enough to reach your liquidation price. Measured from Strike's own price history." },
  referee: { term: "Risk Referee", text: "Apex's rule engine: 12 fixed checks that approve or block an action before anything is sent. It is plain code, not AI." },
  paper: { term: "PAPER", text: "A simulated account that uses real, live prices but never sends orders to Strike." },
  mark: { term: "Mark price", text: "The price Strike uses to value positions and trigger liquidations." },
  stop: { term: "Stop-loss", text: "An order that closes your position if price falls (for a long) or rises (for a short) to a level you choose." },
  reduceonly: { term: "Reduce-only", text: "An order that can only shrink a position — never grow it or flip it." },
  funding: { term: "Funding", text: "A small hourly payment between longs and shorts that keeps the perp close to the real price." },
  slippage: { term: "Slippage", text: "How much worse than the quoted price you actually fill, because the order book is thin." },
  notional: { term: "Position size ($)", text: "The full dollar size of a position: size × price." },
  empirical: { term: "Real history", text: "Based on real past close-to-open moves from Strike's own price history." },
  modeled: { term: "Modeled", text: "Estimated from normal hourly volatility, because history is short or the real market's hours aren't known." },
  signed: { term: "Signed log", text: "A tamper-evident record: each entry is hashed with the one before it and signed, so any edit is detectable." },
  health: { term: "Credit health", text: "A score for a Borrow-and-Earn credit line. 100 is the line where Strike starts recovery; higher is safer." },
};

export function Term({ k, children }: { k: keyof typeof GLOSSARY | string; children?: ReactNode }) {
  const g = GLOSSARY[k];
  if (!g) return <>{children}</>;
  // Keep the bubble inside the viewport: shift it left when the term sits near the right edge.
  const place = (e: SyntheticEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const w = Math.min(270, window.innerWidth * 0.86);
    let shift = 0;
    const over = r.left + w - (window.innerWidth - 12);
    if (over > 0) shift = -over;
    if (r.left + shift < 12) shift = 12 - r.left;
    el.style.setProperty("--tx", `${shift}px`);
  };
  return <span className="term" tabIndex={0} data-tip={g.text} onMouseEnter={place} onFocus={place}>{children ?? g.term}</span>;
}

export function GlossaryButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open]);
  return (
    <>
      <button className="help-btn" onClick={() => setOpen(true)} aria-label="Open glossary">? Glossary</button>
      {open && (
        <div className="modal-back" onClick={() => setOpen(false)}>
          <div className="modal" role="dialog" aria-label="Glossary" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2>Plain-English glossary</h2><button className="btn ghost" onClick={() => setOpen(false)}>Close</button></div>
            <p className="muted" style={{ marginTop: 0 }}>The labels you will see next to numbers:</p>
            <dl className="gloss">
              <dt><span className="badge LIVE"><span className="dot" />LIVE</span></dt><dd>Straight from Strike right now.</dd>
              <dt><span className="badge ESTIMATE"><span className="dot" />ESTIMATE</span></dt><dd>Calculated by Apex from live data. Not a guarantee.</dd>
              <dt><span className="badge SCENARIO"><span className="dot" />SCENARIO</span></dt><dd>A what-if: "if the price fell 5%…". Nothing real happens.</dd>
              <dt><span className="badge PAPER"><span className="dot" />PAPER</span></dt><dd>A simulated account on live prices. No real orders are sent.</dd>
              {Object.values(GLOSSARY).map((g) => (<div key={g.term} className="gloss-row"><dt>{g.term}</dt><dd>{g.text}</dd></div>))}
            </dl>
          </div>
        </div>
      )}
    </>
  );
}

export function ModeBadge({ mode }: { mode: "LIVE" | "PAPER" | "SCENARIO" | "ESTIMATE" }) {
  const tip = { LIVE: "Real Strike account or live data", PAPER: GLOSSARY.paper!.text, SCENARIO: "A what-if. Nothing real happens.", ESTIMATE: "Calculated by Apex from live data" }[mode];
  return <span className={`badge ${mode}`} title={tip}><span className="dot" />{mode}</span>;
}

export function Lbl({ l }: { l: string }) {
  const tip: Record<string, string> = { LIVE: "Straight from Strike", ESTIMATE: "Calculated by Apex from live data", SCENARIO: "A what-if scenario", PAPER: "Simulated account" };
  return <span className="lbl" title={tip[l] ?? l}>{l}</span>;
}

export function PageHead({ title, badge, what, tip }: { title: string; badge?: ReactNode; what: ReactNode; tip?: ReactNode }) {
  return (
    <header className="pagehead">
      <h1>{title}{badge}</h1>
      <p className="what">{what}</p>
      {tip && <p className="tip"><b>Try it:</b> {tip}</p>}
    </header>
  );
}

export function Spark({ closes, w = 120, h = 28 }: { closes: string[]; w?: number; h?: number }) {
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

export const BandPill = ({ band, children }: { band: string; children?: ReactNode }) => <span className={`bandpill ${band.replace("/", "")}`}>{children ?? band}</span>;

export const SESSION_LABEL: Record<string, string> = { open: "Open", closed: "Closed", unknown: "Hours unknown" };
export const SESSION_TIP: Record<string, string> = {
  open: "The real market is open now, so the perp tracks it live.",
  closed: "The real market is closed. The perp still trades, so gaps can build up until it reopens.",
  unknown: "Apex does not know this stock's market hours, so it treats it as closed (the careful assumption).",
};
export const TYPE_LABEL: Record<string, string> = { crypto: "Crypto", equity: "Stock", index: "Index", commodity: "Commodity", fx: "FX", unknown: "Unknown" };

export function SessionChip({ s }: { s: string }) {
  return <span className={`chip ${s}`} title={SESSION_TIP[s] ?? ""}>{SESSION_LABEL[s] ?? s}</span>;
}

// ── rules in plain words ─────────────────────────────────────────────────────
export const RULE_TITLE: Record<string, string> = {
  R1: "Leverage too high", R2: "Position too big", R3: "Portfolio too big", R4: "Too much in one market",
  R5: "Too close to liquidation", R6: "Market not allowed", R7: "Market not trading", R8: "Data too old",
  R9: "Too many actions this hour", R10: "Doesn't fit exchange rules", R11: "Protective order invalid", R12: "Mode not permitted",
};
export const RULE_EXPLAIN: Record<string, string> = {
  R1: "Leverage stays under your cap (lower while the real market is closed)",
  R2: "One position stays under your dollar limit",
  R3: "Your whole book stays under its dollar limit",
  R4: "No single market dominates your book",
  R5: "Liquidation stays far enough away",
  R6: "Only markets and types you allowed",
  R7: "The market is actually trading",
  R8: "Prices and account data are fresh (mark 15 s, order book 10 s)",
  R9: "A cap on actions per hour",
  R10: "Size, price tick and minimums match Strike's rules",
  R11: "Protective orders can only reduce, and can't trigger instantly",
  R12: "PAPER by default; LIVE needs your explicit confirmation",
};

export function plainVerdict(v: Verdict) {
  return v.violations.map((r) => ({ id: r.id, title: RULE_TITLE[r.id] ?? r.id, message: r.message }));
}

// ── audit log in plain words ─────────────────────────────────────────────────
const KIND: Record<string, string> = { protective_stop: "stop-loss", partial_close: "partial close", iso_margin_add: "margin top-up", open: "new position", cancel: "cancel" };

export function logTitle(type: string): string {
  return ({
    simulation: "Trade check", proposal: "Proposal", execution: "Action taken", execution_blocked: "Action refused", weekend_report: "Weekend risk report",
    vault_decision: "Vault decision", credit_health: "Credit check", policy_update: "Limits changed", paper_stop_triggered: "Paper stop triggered",
    live_order_sent: "Order sent to Strike", live_iso_margin_sent: "Margin sent to Strike", execution_error: "Action failed",
  } as Record<string, string>)[type] ?? type.replace(/_/g, " ");
}

export function logSentence(e: LogEntry): string {
  const p = e.payload as Record<string, unknown> & { input?: Record<string, string>; action?: Record<string, string>; violations?: string[] };
  const dir = (s?: string) => (s === "buy" ? "long" : s === "sell" ? "short" : "");
  switch (e.type) {
    case "simulation": {
      const i = p.input ?? {};
      const what = `${dir(i.side)} ${i.notionalUsd ? `$${i.notionalUsd}` : i.size ?? ""} ${i.symbol ?? ""} at ${i.leverage ?? "?"}x`.replace(/\s+/g, " ").trim();
      const v = (p.violations ?? []) as string[];
      return p.decision === "BLOCK" ? `Checked a ${what}: blocked by ${v.map((x) => RULE_TITLE[x] ?? x).join(", ").toLowerCase() || "a safety rule"}.` : `Checked a ${what}: allowed.`;
    }
    case "proposal": return `${p.decision === "APPROVE" ? "Approved" : "Blocked"} proposal: ${String(p.summary ?? "")}`;
    case "execution": {
      const a = p.action ?? {};
      return `${String(p.status ?? "done")} — ${KIND[a.kind ?? ""] ?? a.kind ?? "action"} on ${a.symbol ?? ""}.`;
    }
    case "execution_blocked": return `Refused (${String(p.status)}): ${typeof p.details === "string" ? p.details : JSON.stringify(p.details)}`;
    case "vault_decision": return `${String(p.symbol)}: ${String(p.reasoning ?? p.outcome)}`;
    case "weekend_report": return `Weekend risk report for ${String(p.source)} positions (${Array.isArray(p.positions) ? p.positions.length : 0}).`;
    case "credit_health": return "Checked a credit line's health.";
    case "policy_update": return "Safety limits were updated.";
    default: return JSON.stringify(p).slice(0, 160);
  }
}
