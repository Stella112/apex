import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { C, FONT, MONO, Pill, Shell, outExpo, p } from "./kit";
import { SCENES, T } from "./timeline";

// ── S7: MCP ──────────────────────────────────────────────────────────────────
const TOOLS = [
  "list_markets", "get_market", "get_account_summary", "get_positions", "get_order_history", "simulate_trade", "stress_test_position",
  "weekend_risk_report", "propose_protection", "propose_trade", "execute_proposal", "cancel_order", "get_policy", "set_policy",
  "get_decision_log", "verify_log", "get_fair_value", "vault_status", "vault_decisions", "credit_line_health", "credit_stress_grid",
];
const CALLS = [
  { at: 8.3, tool: "weekend_risk_report", args: 'source: "paper"', out: "17 of 20 stock & index markets: real market closed or unknown", hl: "weekend_risk_report" },
  { at: 10.2, tool: "simulate_trade", args: "NVDA-USD · long · $1,000 · 10x", out: "Referee: BLOCK  ·  safer: long 2.34 at 3x", hl: "simulate_trade" },
  { at: 11.8, tool: "propose_protection", args: "NVDA-USD · stop-loss", out: "Proposal ready · reduce-only · referee APPROVE", hl: "propose_protection" },
  { at: 13.2, tool: "execute_proposal", args: "confirm: true", out: "PAPER · resting simulated stop · audit log #13", hl: "execute_proposal" },
];

export const S7: React.FC = () => {
  const scene = SCENES[6]!;
  const f = useCurrentFrame();
  const win = p(f, T(0.2), 24);
  const active = CALLS.filter((c) => f >= T(c.at)).pop()?.hl;
  const count = Math.round(21 * p(f, T(2.4), 40, outExpo));
  return (
    <Shell scene={scene}>
      <div style={{ position: "absolute", left: 110, top: 66 }}><Pill color={C.info}>MODEL CONTEXT PROTOCOL</Pill></div>
      <div style={{ position: "absolute", left: 110, top: 126, fontSize: 58, fontWeight: 760, letterSpacing: -1.2, lineHeight: 1.1, opacity: p(f, T(0.1), 16) }}>
        Use it from <span style={{ color: C.accent }}>any MCP client</span>
      </div>

      {/* terminal */}
      <div style={{ position: "absolute", left: 110, top: 260, width: 960, height: 620, borderRadius: 20, background: "#0b1017", border: `1px solid ${C.line}`, boxShadow: "0 40px 120px rgba(0,0,0,.55)", opacity: win, transform: `translateY(${(1 - win) * 30}px)`, overflow: "hidden" }}>
        <div style={{ height: 46, background: "#0e131a", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", padding: "0 18px", gap: 9 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c, opacity: 0.85 }} />)}
          <span style={{ marginLeft: 14, color: C.muted, fontSize: 18, fontFamily: MONO }}>MCP client ⇄ apex-mcp · stdio</span>
        </div>
        <div style={{ padding: "26px 30px", fontFamily: MONO, fontSize: 24, lineHeight: 1.45 }}>
          <div style={{ color: C.muted }}>apex-mcp ready · mode paper · 21 tools</div>
          {CALLS.map((c) => {
            const o = p(f, T(c.at), 12);
            if (o <= 0.01) return null;
            const chars = Math.round(p(f, T(c.at), 22, (t) => t) * (c.tool.length + c.args.length + 1));
            const typed = `${c.tool} ${c.args}`.slice(0, chars);
            const showOut = f >= T(c.at) + 26;
            return (
              <div key={c.tool} style={{ marginTop: 22, opacity: o }}>
                <div><span style={{ color: C.accent }}>›</span> <span style={{ color: C.text }}>{typed}</span></div>
                {showOut && <div style={{ color: C.ok, marginTop: 4, opacity: p(f, T(c.at) + 26, 10), paddingLeft: 24 }}>{c.out}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* tools */}
      <div style={{ position: "absolute", left: 1130, top: 262, width: 690 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, opacity: p(f, T(2.0), 16) }}>
          <span style={{ fontFamily: MONO, fontSize: 96, fontWeight: 800, color: C.accent, lineHeight: 1 }}>{count}</span>
          <span style={{ fontSize: 34, color: C.text }}>tools</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
          {TOOLS.map((t, i) => {
            const o = p(f, T(2.6) + i * 3, 12);
            const on = active === t;
            return (
              <span key={t} style={{ opacity: o, transform: `scale(${on ? 1.06 : 1})`, fontFamily: MONO, fontSize: 19, padding: "5px 14px", borderRadius: 999, color: on ? "#04241c" : C.muted, background: on ? C.accent : "#121821", border: `1px solid ${on ? C.accent : C.line}`, boxShadow: on ? `0 0 28px ${C.accent}88` : undefined, fontWeight: on ? 700 : 400 }}>{t}</span>
            );
          })}
        </div>
        <div style={{ marginTop: 26, fontSize: 24, color: C.muted, opacity: p(f, T(6.4), 16), lineHeight: 1.35 }}>stdio or Streamable HTTP · tested with the MCP SDK client against mainnet</div>
      </div>
    </Shell>
  );
};

// ── S8: credit + vault ───────────────────────────────────────────────────────
const Card: React.FC<{ src: string; imgW: number; x: number; y: number; w: number; h: number; at: number; title: string; sub: string; accent: string; shiftY?: number }> = ({ src, imgW, x, y, w, h, at, title, sub, accent, shiftY = 0 }) => {
  const f = useCurrentFrame();
  const o = p(f, at, 26);
  const drift = p(f, at, 260, (t) => t) * 30;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, opacity: o, transform: `translateY(${(1 - o) * 60}px)` }}>
      <div style={{ width: w, height: h, borderRadius: 20, overflow: "hidden", border: `1px solid ${accent}66`, boxShadow: `0 40px 110px rgba(0,0,0,.6), 0 0 70px ${accent}1c`, background: C.panel }}>
        <Img src={staticFile(src)} style={{ width: imgW, display: "block", transform: `translateY(${-shiftY - drift}px)` }} />
      </div>
      <div style={{ marginTop: 22, fontSize: 38, fontWeight: 760, color: accent }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 27, color: C.text, lineHeight: 1.3 }}>{sub}</div>
    </div>
  );
};

export const S8: React.FC = () => {
  const scene = SCENES[7]!;
  const f = useCurrentFrame();
  const chip = p(f, T(4.2), 16);
  return (
    <Shell scene={scene}>
      <div style={{ position: "absolute", left: 110, top: 66 }}><Pill color={C.warn}>AND TWO MORE</Pill></div>
      <Card src="shots/credit-top.png" imgW={1400} x={110} y={150} w={840} h={560} at={T(0.4)} title="Credit-line health" sub="Built from Strike's published Borrow-and-Earn formulas. Every example in the docs is a passing test." accent={C.info} shiftY={0} />
      <Card src="shots/vault-top.png" imgW={1400} x={970} y={150} w={840} h={560} at={T(6.0)} title="Mandate vault (paper)" sub="Trades by a written rulebook. Each decision comes with its reasoning." accent={C.accent} shiftY={0} />
      <div style={{ position: "absolute", left: 140, top: 640, opacity: chip, transform: `translateY(${(1 - chip) * 10}px)` }}><span style={{ fontFamily: MONO, fontSize: 24, color: C.ok, border: `1px solid ${C.ok}77`, background: `${C.ok}14`, padding: "6px 16px", borderRadius: 999 }}>✓ docs examples → unit tests</span></div>
    </Shell>
  );
};

// ── S9: close ────────────────────────────────────────────────────────────────
const Tile: React.FC<{ n: string; label: string; at: number; color: string }> = ({ n, label, at, color }) => {
  const f = useCurrentFrame();
  const o = p(f, at, 20);
  return (
    <div style={{ flex: 1, opacity: o, transform: `translateY(${(1 - o) * 26}px)`, background: C.panel, border: `1px solid ${color}55`, borderRadius: 20, padding: "22px 26px" }}>
      <div style={{ fontFamily: MONO, fontSize: 70, fontWeight: 800, color, lineHeight: 1.05 }}>{n}</div>
      <div style={{ fontSize: 24, color: C.muted, marginTop: 4 }}>{label}</div>
    </div>
  );
};

export const S9: React.FC = () => {
  const scene = SCENES[8]!;
  const f = useCurrentFrame();
  const final = p(f, T(19.2), 22);
  const lines = [
    { at: 4.2, icon: "✓", c: C.ok, t: "Paper trading on live mainnet prices" },
    { at: 8.0, icon: "○", c: C.warn, t: "Real-order path: built, not yet run on mainnet" },
    { at: 12.6, icon: "◆", c: C.info, t: "Limits come from Strike key permissions and the Apex referee, not a smart contract" },
    { at: 18.2, icon: "!", c: C.muted, t: "Not financial advice" },
  ];
  return (
    <Shell scene={scene}>
      <div style={{ position: "absolute", left: 110, top: 66 }}><Pill>WHERE IT STANDS</Pill></div>
      <div style={{ position: "absolute", left: 110, right: 110, top: 150, display: "flex", gap: 24 }}>
        <Tile n="180" label="automated tests passing" at={T(0.4)} color={C.accent} />
        <Tile n="21" label="MCP tools" at={T(1.0)} color={C.info} />
        <Tile n="12" label="safety rules, plain code" at={T(1.6)} color={C.warn} />
        <Tile n="33/33" label="liquidations match Strike" at={T(2.2)} color={C.ok} />
      </div>
      <div style={{ position: "absolute", left: 110, right: 110, top: 440 }}>
        {lines.map((l) => {
          const o = p(f, T(l.at), 18);
          return (
            <div key={l.t} style={{ display: "flex", gap: 22, alignItems: "center", marginBottom: 26, opacity: o, transform: `translateX(${(1 - o) * 40}px)` }}>
              <span style={{ flex: "none", width: 54, height: 54, borderRadius: 27, border: `2px solid ${l.c}`, color: l.c, display: "grid", placeItems: "center", fontSize: 28, fontWeight: 800 }}>{l.icon}</span>
              <span style={{ fontSize: 38, fontWeight: 600, lineHeight: 1.2 }}>{l.t}</span>
            </div>
          );
        })}
      </div>
      <AbsoluteFill style={{ background: "rgba(8,11,16,.93)", opacity: final, alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ textAlign: "center", transform: `translateY(${(1 - final) * 24}px)` }}>
          <svg width={120} height={108} viewBox="0 0 32 28"><path d="M16 1 30 27H2z" fill={C.accent} /><path d="M16 11 22 23H10z" fill="#080b10" /></svg>
          <div style={{ fontSize: 112, fontWeight: 800, letterSpacing: 12, marginTop: 6 }}>APEX</div>
          <div style={{ fontSize: 50, fontWeight: 650, color: C.text, marginTop: 6 }}>Know your risk before the weekend.</div>
          <div style={{ fontFamily: MONO, fontSize: 34, color: C.accent, marginTop: 30 }}>github.com/Stella112/apex</div>
        </div>
      </AbsoluteFill>
      <span style={{ display: "none", fontFamily: FONT }} />
    </Shell>
  );
};
