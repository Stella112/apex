import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import gap from "../src_gapstats.json";
import nvda from "../src_nvda.json";
import { C, Cover, Cursor, FONT, Frame, Hi, MONO, Pan, Pill, Shell, inOut, lin, outExpo, p } from "./kit";
import { SCENES, T } from "./timeline";

// ── S5: weekend gap statistics (real data) ───────────────────────────────────
interface Row { symbol: string; underlying: string; p5: number; method: string; samples: number }
const ROWS = (gap as Row[]).slice(0, 11);
const MAXP = Math.max(...ROWS.map((r) => r.p5));
const X_BAR = 450, W_BAR = 700;

const STEPS = [
  { at: 2.8, n: "1", t: "Find every close → open gap", s: "in Strike's hourly price history" },
  { at: 6.2, n: "2", t: "Measure each move", s: "from the last price before the close to the first after the open" },
  { at: 9.8, n: "3", t: "Chance a gap alone reaches your liquidation price", s: "empirical when history exists, modeled when it doesn't" },
];

// beeswarm positions for the 97 NVDA gaps
const RET = (nvda as Array<{ ret: number }>).map((x) => x.ret).sort((a, b) => a - b);
const DOTS = (() => {
  const bins = new Map<number, number>();
  return RET.map((r, i) => {
    const b = Math.round(r / 0.004);
    const h = bins.get(b) ?? 0;
    bins.set(b, h + 1);
    return { r, h, i };
  });
})();
const DX0 = 330, DW = 1260, RMIN = -0.06, RMAX = 0.075;
const dx = (r: number) => DX0 + ((r - RMIN) / (RMAX - RMIN)) * DW;

export const S5: React.FC = () => {
  const scene = SCENES[4]!;
  const f = useCurrentFrame();
  const dim = p(f, T(13.2), 14) * (1 - p(f, T(16.4), 14));
  const panel = p(f, T(13.3), 18) * (1 - p(f, T(16.5), 14));
  const count = Math.round(97 * p(f, T(13.6), 50, outExpo));
  const modeled = p(f, T(16.8), 18);
  return (
    <Shell scene={scene}>
      <div style={{ position: "absolute", left: 110, top: 66 }}><Pill color={C.info}>WEEKEND-GAP STATISTICS · LIVE DATA</Pill></div>
      <div style={{ position: "absolute", left: 110, top: 126, fontSize: 56, fontWeight: 760, letterSpacing: -1.2, lineHeight: 1.1, opacity: p(f, T(0.1), 16) }}>
        Chance a long loses <span style={{ color: C.danger }}>5%+</span> in a closed-market gap
      </div>
      <div style={{ position: "absolute", left: 110, top: 200, fontSize: 25, color: C.muted, opacity: p(f, T(0.4), 16) }}>Every stock &amp; index perp on Strike · riskiest first</div>

      <div style={{ opacity: 1 - dim * 0.82 }}>
        {ROWS.map((r, i) => {
          const y = 262 + i * 62;
          const g = p(f, T(0.7) + i * 5, 30);
          const w = (r.p5 / MAXP) * W_BAR * g;
          const isM = r.method === "MODELED";
          const hl = isM ? modeled : 0;
          return (
            <div key={r.symbol} style={{ position: "absolute", left: 110, top: y, width: 1250, height: 50, opacity: Math.min(1, g * 3) }}>
              <div style={{ position: "absolute", left: 0, top: 6, width: 230, fontSize: 28, fontWeight: 700 }}>{r.symbol}</div>
              <div style={{ position: "absolute", left: 165, top: 11, fontSize: 18, color: r.underlying === "unknown" ? C.danger : C.warn, border: `1px solid ${(r.underlying === "unknown" ? C.danger : C.warn)}77`, borderRadius: 999, padding: "1px 12px", whiteSpace: "nowrap" }}>{r.underlying === "unknown" ? "hours unknown" : "closed"}</div>
              <div style={{ position: "absolute", left: X_BAR - 110, top: 5, width: W_BAR, height: 40, borderRadius: 8, background: "#151c26" }} />
              <div style={{ position: "absolute", left: X_BAR - 110, top: 5, width: w, height: 40, borderRadius: 8, background: isM ? `repeating-linear-gradient(135deg, ${C.danger}d0 0 10px, ${C.danger}66 10px 20px)` : `linear-gradient(90deg, ${C.warn}cc, ${C.danger})`, boxShadow: hl > 0.5 ? `0 0 ${30 * hl}px ${C.danger}88` : undefined }} />
              <div style={{ position: "absolute", left: X_BAR - 110 + w + 14, top: 8, fontFamily: MONO, fontSize: 25, fontWeight: 700, opacity: g }}>{(r.p5 * g).toFixed(1)}%</div>
              <div style={{ position: "absolute", left: X_BAR - 110 + W_BAR + 120, top: 12, fontSize: 21, color: C.muted, whiteSpace: "nowrap" }}>{isM ? "modeled" : `${r.samples} real gaps`}</div>
            </div>
          );
        })}
      </div>

      {/* method steps */}
      <div style={{ position: "absolute", left: 1400, top: 270, width: 420 }}>
        {STEPS.map((s) => {
          const o = p(f, T(s.at), 18) * (1 - dim);
          return (
            <div key={s.n} style={{ opacity: o, transform: `translateX(${(1 - o) * 30}px)`, display: "flex", gap: 16, marginBottom: 30 }}>
              <span style={{ flex: "none", width: 44, height: 44, borderRadius: 22, background: C.accent, color: "#04241c", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 24 }}>{s.n}</span>
              <div><div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2 }}>{s.t}</div><div style={{ fontSize: 21, color: C.muted, marginTop: 4, lineHeight: 1.3 }}>{s.s}</div></div>
            </div>
          );
        })}
      </div>

      {modeled > 0.01 && (
        <div style={{ position: "absolute", left: 1400, top: 700, width: 420, opacity: modeled, transform: `translateY(${(1 - modeled) * 16}px)`, background: `${C.danger}14`, border: `1px solid ${C.danger}77`, borderRadius: 16, padding: "18px 22px" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.danger }}>Hours unknown → modeled</div>
          <div style={{ fontSize: 22, color: C.text, marginTop: 6, lineHeight: 1.3 }}>Apex says so, estimates the risk from hourly volatility, and assumes the market is closed.</div>
        </div>
      )}

      {/* NVDA real-gap dot plot */}
      <AbsoluteFill style={{ background: `rgba(8,11,16,${0.55 * dim})`, opacity: panel > 0.01 ? 1 : 0 }} />
      {panel > 0.01 && (
        <div style={{ position: "absolute", left: 160, top: 220, width: 1600, height: 640, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 26, opacity: panel, transform: `scale(${0.96 + 0.04 * panel})`, boxShadow: "0 40px 120px rgba(0,0,0,.6)" }}>
          <div style={{ position: "absolute", left: 50, top: 34, fontSize: 24, color: C.muted, letterSpacing: 2 }}>NVDA · EVERY CLOSE → OPEN GAP IN STRIKE'S HISTORY</div>
          <div style={{ position: "absolute", left: 50, top: 70, fontFamily: MONO, fontSize: 120, fontWeight: 800, lineHeight: 1 }}>{count}<span style={{ fontSize: 40, color: C.muted, fontFamily: FONT, fontWeight: 600 }}> real gaps</span></div>
          <svg width={1600} height={640} style={{ position: "absolute", inset: 0 }}>
            <line x1={dx(0) - 160} x2={dx(0) - 160} y1={300} y2={540} stroke={C.line} strokeWidth={2} />
            <text x={dx(0) - 160} y={566} textAnchor="middle" fill={C.muted} fontSize={22} fontFamily={FONT}>no move</text>
            <line x1={dx(-0.05) - 160} x2={dx(-0.05) - 160} y1={290} y2={540} stroke={C.danger} strokeWidth={3} strokeDasharray="10 8" />
            <text x={dx(-0.05) - 160} y={566} textAnchor="middle" fill={C.danger} fontSize={24} fontWeight={700} fontFamily={FONT}>−5%</text>
            <line x1={100} x2={1500} y1={540} y2={540} stroke={C.line} strokeWidth={2} />
            {DOTS.map((d) => {
              const o = p(f, T(13.7) + d.i * 0.55, 8);
              return <circle key={d.i} cx={dx(d.r) - 160} cy={522 - d.h * 19} r={8.5} fill={d.i === 0 ? C.warn : C.accent} opacity={o * 0.92} />;
            })}
          </svg>
          <div style={{ position: "absolute", right: 56, top: 62, textAlign: "right", opacity: p(f, T(14.9), 16) }}>
            <div style={{ fontSize: 56, fontWeight: 800, color: C.ok, lineHeight: 1.05 }}>0 of {RET.length}</div>
            <div style={{ fontSize: 26, color: C.text }}>fell 5% or more</div>
            <div style={{ fontSize: 22, color: C.warn, marginTop: 6 }}>worst gap: {(RET[0]! * 100).toFixed(1)}%</div>
          </div>
        </div>
      )}
    </Shell>
  );
};

// ── S6: protect + audit ──────────────────────────────────────────────────────
export const S6: React.FC = () => {
  const scene = SCENES[5]!;
  const f = useCurrentFrame();
  const clickA = T(1.8), clickC = T(12.8), clickV = T(17.0);
  const pB = p(f, T(2.0), 10), pC = p(f, T(12.9), 8), pD = p(f, T(14.6), 12);
  return (
    <Shell scene={scene}>
      <Frame title="apex · Weekend risk → protection" badge={{ text: "PAPER · simulated on live prices", color: C.warn }}>
        <Pan src="shots/positions-top.png" w={2880} h={1800} keys={[{ f: 0, cx: 1440, cy: 800, z: 1.22 }, { f: T(1.8), cx: 1700, cy: 850, z: 1.4 }, { f: scene.frames, cx: 1700, cy: 850, z: 1.4 }]} opacity={1}>
          <Hi x={2075} y={832} w={180} h={78} at={T(0.5)} until={T(1.6)} color={C.ok} label="Gap chance" below />
          <Cursor path={[{ f: T(0.3), x: 1500, y: 1050 }, { f: T(1.6), x: 2496, y: 874 }]} click={clickA} />
        </Pan>
        <Pan src="shots/positions-proposal.png" w={2880} h={1800} keys={[{ f: 0, cx: 1440, cy: 900, z: 1.2 }, { f: T(3.0), cx: 1090, cy: 1300, z: 1.35 }, { f: T(7.0), cx: 1090, cy: 1300, z: 1.45 }, { f: T(12.0), cx: 1090, cy: 1300, z: 1.35 }, { f: scene.frames, cx: 1090, cy: 1300, z: 1.35 }]} opacity={pB}>
          <Hi x={153} y={1244} w={1720} h={48} at={T(3.2)} until={T(6.9)} color={C.accent} label="Explained in one sentence" />
          <Hi x={153} y={1350} w={1010} h={92} at={T(7.2)} until={T(9.4)} color={C.warn} label="Waits for your confirmation" below />
          <Hi x={880} y={1244} w={580} h={48} at={T(9.6)} until={T(11.0)} color={C.info} label="Reduce-only: can only shrink a position" />
          <Hi x={153} y={1181} w={145} h={52} at={T(11.2)} until={T(12.6)} color={C.warn} label="PAPER: simulated on live prices" />
          <Cursor path={[{ f: T(11.6), x: 1800, y: 1700 }, { f: T(12.6), x: 293, y: 1397 }]} click={clickC} />
        </Pan>
        <Pan src="shots/positions-confirmed.png" w={2880} h={1800} keys={[{ f: 0, cx: 1090, cy: 805, z: 1.35 }, { f: scene.frames, cx: 1090, cy: 805, z: 1.35 }]} opacity={pC * (1 - pD)}>
          <Hi x={153} y={962} w={2576} h={76} at={T(13.1)} until={T(14.5)} color={C.ok} label="Recorded as entry #13 in the audit log" />
        </Pan>
        <Pan src="shots/log.png" w={2880} h={1800} keys={[{ f: 0, cx: 1440, cy: 820, z: 1.08 }, { f: T(15.6), cx: 1440, cy: 820, z: 1.08 }, { f: T(17.2), cx: 1400, cy: 700, z: 1.3 }, { f: scene.frames, cx: 1400, cy: 700, z: 1.3 }]} opacity={pD}>
          <Cover x={668} y={532} w={940} h={56} color="#121821" until={clickV} fade={6} />
          <Hi x={122} y={925} w={2635} h={200} at={T(14.9)} until={T(16.5)} color={C.accent} label="Your confirmed stop-loss, recorded" />
          <Hi x={668} y={528} w={940} h={62} at={clickV + 8} color={C.ok} />
          <Cursor path={[{ f: T(15.4), x: 1500, y: 1100 }, { f: T(16.8), x: 292, y: 556 }]} click={clickV} />
        </Pan>
      </Frame>
      <span style={{ display: "none" }}>{inOut(0)}{lin(0)}</span>
    </Shell>
  );
};
