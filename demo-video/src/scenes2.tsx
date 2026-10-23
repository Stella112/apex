import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, Cursor, FONT, Frame, Hi, MONO, Pan, Pill, Shell, outExpo, p } from "./kit";
import { SCENES, T } from "./timeline";

// ── S3: live proof ───────────────────────────────────────────────────────────
export const S3: React.FC = () => {
  const scene = SCENES[2]!;
  const f = useCurrentFrame();
  const count = Math.round(33 * p(f, T(10.2), 40, outExpo));
  const panel = p(f, T(10.0), 24);
  return (
    <Shell scene={scene}>
      <Frame title="apex · Overview — live data from Strike mainnet" badge={{ text: "LIVE", color: C.ok }}>
        <Pan
          src="shots/overview.png" w={2880} h={4100}
          keys={[
            { f: 0, cx: 1440, cy: 700, z: 1.0 },
            { f: T(3.8), cx: 1440, cy: 760, z: 1.1 },
            { f: T(5.9), cx: 830, cy: 3030, z: 1.45 },
            { f: T(9.2), cx: 830, cy: 3030, z: 1.5 },
            { f: T(10.3), cx: 1560, cy: 1326, z: 1.75 },
            { f: SCENES[2]!.frames, cx: 1560, cy: 1326, z: 1.85 },
          ]}
        >
          <Hi x={145} y={636} w={1240} h={60} at={T(1.0)} until={T(5.2)} label="Live from Strike mainnet" below />
          <Hi x={1130} y={2795} w={330} h={590} at={T(6.4)} until={T(9.6)} color={C.ok} label="≈ 0.004% apart" />
          <Hi x={1458} y={1201} w={649} h={250} at={T(10.4)} color={C.ok} />
        </Pan>
        <div style={{ position: "absolute", right: 34, top: 34, opacity: panel, transform: `translateY(${(1 - panel) * -20}px)`, background: "rgba(10,14,19,.9)", border: `1px solid ${C.ok}88`, borderRadius: 20, padding: "22px 34px", boxShadow: `0 0 80px ${C.ok}30` }}>
          <div style={{ fontSize: 22, color: C.muted, letterSpacing: 2 }}>APEX vs STRIKE · REAL POSITIONS</div>
          <div style={{ fontFamily: MONO, fontSize: 112, fontWeight: 800, color: C.ok, lineHeight: 1.05 }}>{count}<span style={{ color: C.muted, fontSize: 64 }}> / 33</span></div>
          <div style={{ fontSize: 26, color: C.text }}>liquidation prices match Strike's own</div>
        </div>
      </Frame>
    </Shell>
  );
};

// ── S4: check a trade ────────────────────────────────────────────────────────
const RULES = [
  "Leverage too high", "Position too big", "Portfolio too big", "Too much in one market", "Too close to liquidation", "Market not allowed",
  "Market not trading", "Data too old", "Too many actions this hour", "Doesn't fit exchange rules", "Protective order invalid", "Mode not permitted",
];

export const S4: React.FC = () => {
  const scene = SCENES[3]!;
  const f = useCurrentFrame();
  const click = T(3.9);
  const swap = p(f, click + 6, 10);
  const keys = [
    { f: 0, cx: 1440, cy: 780, z: 1.0 },
    { f: T(1.4), cx: 930, cy: 640, z: 1.3 },
    { f: T(3.7), cx: 930, cy: 640, z: 1.35 },
    { f: T(5.2), cx: 1835, cy: 930, z: 1.45 },
    { f: T(11.8), cx: 1815, cy: 1110, z: 1.3 },
    { f: T(16.4), cx: 1815, cy: 1900, z: 1.3 },
    { f: T(26.2), cx: 1815, cy: 1900, z: 1.36 },
    { f: scene.frames, cx: 1815, cy: 1900, z: 1.36 },
  ];
  const panel = p(f, T(26.5), 22);
  return (
    <Shell scene={scene}>
      <Frame title="apex · Check a trade" badge={{ text: "SCENARIO · nothing is sent to Strike", color: C.info }}>
        <Pan src="shots/circuit-empty.png" w={2880} h={1800} keys={keys} opacity={1 - swap}>
          <Cursor path={[{ f: T(1.6), x: 1500, y: 420 }, { f: T(3.7), x: 262, y: 545 }]} click={click} />
          <Hi x={89} y={481} w={346} h={128} at={T(2.2)} until={click + 8} label="Pick an example" below />
        </Pan>
        <Pan src="shots/circuit-risky.png" w={2880} h={2538} keys={keys} opacity={swap}>
          <Hi x={1040} y={870} w={940} h={52} at={T(7.4)} until={T(10.8)} color={C.danger} label="Leverage too high while the US market is closed" />
          <Hi x={1040} y={920} w={940} h={52} at={T(10.9)} until={T(12.6)} color={C.danger} label="Position too big" />
          <Hi x={1040} y={1021} w={940} h={52} at={T(12.7)} until={T(16.3)} color={C.danger} />
          <Hi x={881} y={1138} w={619} h={288} at={T(13.2)} until={T(16.3)} color={C.danger} label="Only 9% from liquidation" below />
          <Hi x={881} y={1454} w={1909} h={725} at={T(16.8)} until={T(26.3)} color={C.ok} />
        </Pan>
        <AbsoluteFill style={{ background: "rgba(8,11,16,.86)", opacity: panel, alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ transform: `scale(${0.96 + 0.04 * panel})`, textAlign: "center" }}>
            <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: -1 }}>12 safety checks. <span style={{ color: C.accent }}>Plain code.</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, margin: "34px auto 0", width: 1560 }}>
              {RULES.map((r, i) => {
                const o = p(f, T(26.7) + i * 4, 12);
                return (
                  <div key={r} style={{ opacity: o, transform: `translateY(${(1 - o) * 14}px)`, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 18px", textAlign: "left", display: "flex", gap: 12, alignItems: "center" }}>
                    <span style={{ fontFamily: MONO, fontWeight: 800, color: C.accent, fontSize: 22 }}>R{i + 1}</span>
                    <span style={{ fontSize: 24, color: C.text }}>{r}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 34, opacity: p(f, T(28.8), 16) }}><Pill color={C.warn} style={{ fontSize: 28, padding: "10px 26px" }}>NO AI DECIDES WHAT'S SAFE</Pill></div>
          </div>
        </AbsoluteFill>
      </Frame>
      <span style={{ display: "none", fontFamily: FONT }} />
    </Shell>
  );
};
