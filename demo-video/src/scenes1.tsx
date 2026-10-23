import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, FONT, MONO, Pill, Shell, clampX, inOut, lin, outExpo, p } from "./kit";
import { SCENES, T } from "./timeline";

// ── S1: the weekend gap (illustration) ───────────────────────────────────────
const X0 = 160, X1 = 1760, OPEN_END = 330, REOPEN = 1560;
const LIQ_Y = 820;

function makePath(n: number) {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pts: Array<{ x: number; y: number }> = [];
  let walk = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    walk = walk * 0.9 + (rnd() - 0.5) * 16;
    const u = Math.min(1, Math.max(0, (t - 0.4) / 0.42));
    const drift = u * u * (3 - 2 * u) * 235;
    pts.push({ x: X0 + t * (X1 - X0), y: 655 + Math.sin(t * 38) * 9 + walk + drift });
  }
  return pts;
}
const PATH = makePath(240);
const CROSS = PATH.findIndex((q) => q.y >= LIQ_Y);

const Headline: React.FC<{ segs: Array<{ a: number; b: number; text: React.ReactNode }> }> = ({ segs }) => {
  const f = useCurrentFrame();
  return (
    <>
      {segs.map((s, i) => {
        const o = Math.min(p(f, s.a, 14), 1 - p(f, s.b - 10, 10));
        if (o <= 0.01) return null;
        return <div key={i} style={{ position: "absolute", left: 110, top: 128, width: 1700, fontSize: 66, fontWeight: 760, letterSpacing: -1.5, lineHeight: 1.08, opacity: o, transform: `translateY(${(1 - o) * 18}px)` }}>{s.text}</div>;
      })}
    </>
  );
};

export const S1: React.FC = () => {
  const scene = SCENES[0]!;
  const f = useCurrentFrame();
  const closedW = p(f, T(0.9), 52, inOut) * (REOPEN - OPEN_END);
  const lane1 = p(f, T(0.2), 26);
  const lane2 = p(f, T(4.0), 50, inOut);
  const draw = p(f, T(9.2), T(14.2) - T(9.2), lin);
  const vis = Math.floor(draw * (PATH.length - 1));
  const crossed = vis >= CROSS;
  const flash = crossed ? p(f, T(9.2) + Math.round(((CROSS / (PATH.length - 1)) * (T(14.2) - T(9.2)))), 6) * (1 - p(f, T(9.2) + Math.round(((CROSS / (PATH.length - 1)) * (T(14.2) - T(9.2)))) + 8, 40)) : 0;
  const cp = PATH[CROSS]!;
  const crossFrame = T(9.2) + Math.round((CROSS / (PATH.length - 1)) * (T(14.2) - T(9.2)));
  const q = p(f, T(17.0), 22);
  const chips = ["NVDA", "TSLA", "NAS100", "XAU"];
  return (
    <Shell scene={scene}>
      <div style={{ position: "absolute", left: 110, top: 66 }}><Pill>THE PROBLEM</Pill></div>
      <div style={{ position: "absolute", right: 110, top: 74, fontSize: 20, color: C.muted, letterSpacing: 1 }}>ILLUSTRATION · NOT MARKET DATA</div>
      <Headline segs={[
        { a: T(0.1), b: T(3.7), text: <>Every weekend, the <span style={{ color: C.warn }}>stock market closes.</span></> },
        { a: T(3.7), b: T(9.2), text: <>On Strike, the <span style={{ color: C.accent }}>perps keep trading.</span></> },
        { a: T(9.2), b: T(16.9), text: <>A gap can <span style={{ color: C.danger }}>liquidate you</span> before anyone reacts.</> },
      ]} />

      {/* lane 1: the real market */}
      <div style={{ position: "absolute", left: X0, top: 262, fontSize: 24, color: C.muted, opacity: lane1 }}>Real market · NVIDIA, Tesla, Nasdaq-100</div>
      <div style={{ position: "absolute", left: X0, top: 300, width: OPEN_END - X0, height: 62, borderRadius: 12, background: `linear-gradient(90deg, ${C.ok}, #1fb36a)`, opacity: lane1, transform: `scaleX(${lane1})`, transformOrigin: "0 0" }} />
      <div style={{ position: "absolute", left: OPEN_END + 6, top: 300, width: Math.max(0, closedW - 12), height: 62, borderRadius: 12, border: `1.5px solid ${C.warn}88`, background: `repeating-linear-gradient(135deg, ${C.warn}22 0 12px, ${C.warn}0a 12px 24px)`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", color: C.warn, fontWeight: 700, fontSize: 25, letterSpacing: 3, whiteSpace: "nowrap" }}>
        {closedW > 700 ? "MARKET CLOSED · 65½ HOURS" : ""}
      </div>
      <div style={{ position: "absolute", left: REOPEN, top: 300, width: X1 - REOPEN, height: 62, borderRadius: 12, background: `linear-gradient(90deg, ${C.ok}, #1fb36a)`, opacity: p(f, T(2.9), 12) }} />
      <div style={{ position: "absolute", left: OPEN_END - 62, top: 368, fontSize: 21, color: C.muted, fontFamily: MONO, opacity: lane1 }}>Fri 16:00</div>
      <div style={{ position: "absolute", left: REOPEN - 8, top: 368, fontSize: 21, color: C.muted, fontFamily: MONO, opacity: p(f, T(2.9), 12) }}>Mon 09:30</div>

      {/* lane 2: the perp */}
      <div style={{ position: "absolute", left: X0, top: 412, fontSize: 24, color: C.muted, opacity: lane2 > 0.05 ? 1 : 0 }}>Strike perp · trades 24/7</div>
      <div style={{ position: "absolute", left: X0, top: 450, width: (X1 - X0) * lane2, height: 50, borderRadius: 12, background: `linear-gradient(90deg, ${C.accent}, #1aa88a)`, overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, width: 220, left: ((f * 9) % 1900) - 220, background: "linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent)" }} />
      </div>
      <div style={{ position: "absolute", left: X0, top: 512, display: "flex", gap: 12 }}>
        {chips.map((c, i) => {
          const o = p(f, T(5.0) + i * 12, 14);
          return (
            <span key={c} style={{ opacity: o, transform: `translateY(${(1 - o) * 10}px)`, fontFamily: MONO, fontSize: 21, fontWeight: 700, color: C.text, border: `1px solid ${C.accent}77`, background: `${C.accent}14`, borderRadius: 999, padding: "4px 16px", display: "inline-flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 9, height: 9, borderRadius: 5, background: C.accent, opacity: 0.55 + 0.45 * Math.sin(f / 5 + i) }} />{c}-USD
            </span>
          );
        })}
      </div>

      {/* price chart */}
      {draw > 0 && (
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <line x1={X0} x2={X1} y1={LIQ_Y} y2={LIQ_Y} stroke={C.danger} strokeWidth={2.5} strokeDasharray="14 10" opacity={p(f, T(9.0), 14)} />
          <text x={X1} y={LIQ_Y - 14} textAnchor="end" fill={C.danger} fontSize={24} fontWeight={700} fontFamily={FONT} opacity={p(f, T(9.0), 14)}>Your liquidation price</text>
          <polyline fill="none" stroke={C.text} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" points={PATH.slice(0, vis + 1).map((q2) => `${q2.x},${q2.y}`).join(" ")} />
          <circle cx={PATH[0]!.x} cy={PATH[0]!.y} r={9} fill={C.accent} />
          <text x={PATH[0]!.x + 18} y={PATH[0]!.y - 62} fill={C.accent} fontSize={24} fontWeight={700} fontFamily={FONT}>Your leveraged long</text>
          {vis > 0 && <circle cx={PATH[Math.min(vis, PATH.length - 1)]!.x} cy={PATH[Math.min(vis, PATH.length - 1)]!.y} r={9} fill={crossed ? C.danger : C.text} />}
          {crossed && <circle cx={cp.x} cy={cp.y} r={14 + 40 * p(f, crossFrame, 24)} fill="none" stroke={C.danger} strokeWidth={5} opacity={1 - p(f, crossFrame, 24)} />}
        </svg>
      )}
      {crossed && (
        <div style={{ position: "absolute", left: cp.x - 250, top: cp.y + 36, opacity: p(f, crossFrame, 10), transform: `scale(${0.9 + 0.1 * p(f, crossFrame, 14)})`, textAlign: "center", width: 500 }}>
          <div style={{ display: "inline-block", background: C.danger, color: "#fff", fontWeight: 800, fontSize: 34, letterSpacing: 3, padding: "6px 24px", borderRadius: 10 }}>LIQUIDATED</div>
          <div style={{ fontSize: 24, color: C.muted, marginTop: 8 }}>Sunday night. Nobody is awake to react.</div>
        </div>
      )}
      <AbsoluteFill style={{ background: C.danger, opacity: flash * 0.22, pointerEvents: "none" }} />

      {/* the question */}
      <AbsoluteFill style={{ background: "rgba(8,11,16,.82)", opacity: q, justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 118, fontWeight: 800, letterSpacing: -3, textAlign: "center", transform: `scale(${0.94 + 0.06 * q})`, lineHeight: 1.05 }}>
          How likely is<br /><span style={{ color: C.accent }}>that?</span>
        </div>
        <div style={{ fontSize: 30, color: C.muted, marginTop: 24 }}>Before you click buy, there is no way to see it.</div>
      </AbsoluteFill>
    </Shell>
  );
};

// ── S2: meet Apex ────────────────────────────────────────────────────────────
export const S2: React.FC = () => {
  const scene = SCENES[1]!;
  const f = useCurrentFrame();
  const draw = p(f, T(0.1), 40, inOut);
  const fill = p(f, T(1.0), 18);
  const shift = p(f, T(2.2), 28, inOut);
  const cards = [
    { at: T(2.6), k: "CHECK", t: "Every trade, before you place it", c: C.accent, icon: "✓" },
    { at: T(4.9), k: "MEASURE", t: "Weekend gap risk, from Strike's own price history", c: C.info, icon: "↗" },
    { at: T(8.6), k: "CONFIRM", t: "Nothing moves without your OK", c: C.warn, icon: "●" },
  ];
  const y = 470 - 210 * shift;
  const sc = 1 - 0.28 * shift;
  const L = 2 * Math.PI;
  return (
    <Shell scene={scene}>
      <div style={{ position: "absolute", left: 0, right: 0, top: y, transform: `scale(${sc})`, transformOrigin: "50% 0", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <svg width={190} height={170} viewBox="0 0 32 28" style={{ overflow: "visible" }}>
          <path d="M16 1 30 27H2z" fill="none" stroke={C.accent} strokeWidth={1.1} strokeLinejoin="round" strokeDasharray={90} strokeDashoffset={90 * (1 - draw)} />
          <path d="M16 1 30 27H2z" fill={C.accent} opacity={fill} />
          <path d="M16 11 22 23H10z" fill={C.bg} opacity={fill} />
        </svg>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {"APEX".split("").map((ch, i) => {
            const o = p(f, T(0.7) + i * 4, 16);
            return <span key={i} style={{ fontSize: 150, fontWeight: 800, letterSpacing: 14, opacity: o, transform: `translateY(${(1 - o) * 40}px)` }}>{ch}</span>;
          })}
        </div>
        <div style={{ fontSize: 38, color: C.muted, letterSpacing: 1, opacity: p(f, T(1.5), 18), marginTop: -6 }}>A risk desk for Strike Finance</div>
      </div>
      <div style={{ position: "absolute", left: 130, right: 130, top: 640, display: "flex", gap: 36 }}>
        {cards.map((c) => {
          const o = p(f, c.at, 20);
          return (
            <div key={c.k} style={{ flex: 1, background: `linear-gradient(180deg, ${C.panel}, ${C.bg})`, border: `1px solid ${c.c}66`, borderRadius: 22, padding: "30px 34px", opacity: o, transform: `translateY(${(1 - o) * 50}px)`, boxShadow: `0 0 60px ${c.c}18` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ width: 46, height: 46, borderRadius: 23, background: `${c.c}22`, color: c.c, display: "grid", placeItems: "center", fontSize: 24, fontWeight: 800 }}>{c.icon}</span>
                <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: 3, color: c.c }}>{c.k}</span>
              </div>
              <div style={{ fontSize: 31, marginTop: 18, lineHeight: 1.25, color: C.text }}>{c.t}</div>
            </div>
          );
        })}
      </div>
      <span style={{ display: "none" }}>{L}{clampX.extrapolateLeft}{outExpo(0)}</span>
    </Shell>
  );
};
