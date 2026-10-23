import React, { createContext, useContext } from "react";
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FPS, LEAD, type SceneInfo } from "./timeline";

export const C = {
  bg: "#0a0e13", panel: "#121821", panel2: "#18202b", line: "#243041", text: "#e6edf5", muted: "#8a99ad",
  accent: "#22d3a6", danger: "#ff5d6c", warn: "#f5b942", info: "#6aa8ff", ok: "#3ddc84",
};
export const FONT = "'Segoe UI Variable Display','Segoe UI',Inter,system-ui,sans-serif";
export const MONO = "'Cascadia Mono','Cascadia Code',Consolas,monospace";

export const clampX = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const outExpo = Easing.bezier(0.16, 1, 0.3, 1);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);
export const lin = (t: number) => t;
/** 0 → 1 progress from frame `s` over `d` frames. */
export const p = (f: number, s: number, d: number, e: (t: number) => number = outExpo) => interpolate(f, [s, s + d], [0, 1], { ...clampX, easing: e });

// ── background ───────────────────────────────────────────────────────────────
export const Bg: React.FC = () => {
  const f = useCurrentFrame();
  const mask = "radial-gradient(ellipse at center, black 25%, transparent 80%)";
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(1100px 600px at 12% -5%, rgba(34,211,166,.14), transparent 60%), radial-gradient(1000px 700px at 100% 110%, rgba(106,168,255,.09), transparent 60%)" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: `linear-gradient(${C.line}66 1px, transparent 1px), linear-gradient(90deg, ${C.line}66 1px, transparent 1px)`, backgroundSize: "90px 90px", backgroundPosition: `${-(f * 0.3) % 90}px ${-(f * 0.15) % 90}px`, opacity: 0.32, WebkitMaskImage: mask, maskImage: mask }} />
    </AbsoluteFill>
  );
};

// ── browser-style window ─────────────────────────────────────────────────────
export const BW = 1760;
export const BH = 880;
export const Frame: React.FC<{ title: string; badge?: { text: string; color: string }; children: React.ReactNode; enter?: number; x?: number; y?: number; w?: number }> = ({ title, badge, children, enter = 0, x = 80, y = 40 }) => {
  const f = useCurrentFrame();
  const t = p(f, enter, 26);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: BW, height: BH + 44, borderRadius: 20, overflow: "hidden", background: C.panel, border: `1px solid ${C.line}`, boxShadow: "0 50px 140px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.03)", opacity: t, transform: `translateY(${(1 - t) * 34}px) scale(${0.97 + 0.03 * t})` }}>
      <div style={{ height: 44, display: "flex", alignItems: "center", padding: "0 18px", gap: 9, background: "#0e131a", borderBottom: `1px solid ${C.line}` }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c, opacity: 0.85 }} />)}
        <span style={{ marginLeft: 16, fontFamily: FONT, fontSize: 18, color: C.muted }}>{title}</span>
        {badge && <span style={{ marginLeft: "auto", fontFamily: FONT, fontSize: 15, fontWeight: 700, letterSpacing: 1, color: badge.color, border: `1px solid ${badge.color}88`, background: `${badge.color}1a`, padding: "3px 12px", borderRadius: 999 }}>{badge.text}</span>}
      </div>
      <div style={{ position: "relative", width: BW, height: BH, overflow: "hidden" }}>{children}</div>
    </div>
  );
};

// ── camera ───────────────────────────────────────────────────────────────────
const ScaleCtx = createContext(1);
export const useScale = () => useContext(ScaleCtx);

export interface Key { f: number; cx: number; cy: number; z: number }

/** Shows a screenshot (source px coordinates) with a keyframed pan/zoom. Children are positioned in source px. */
export const Pan: React.FC<{ src: string; w: number; h: number; keys: Key[]; children?: React.ReactNode; opacity?: number }> = ({ src, w, h, keys, children, opacity = 1 }) => {
  const f = useCurrentFrame();
  const fs = keys.map((k) => k.f);
  const ip = (sel: (k: Key) => number) => interpolate(f, fs, keys.map(sel), { ...clampX, easing: inOut });
  const s = (BW / w) * ip((k) => k.z);
  const cx = ip((k) => k.cx), cy = ip((k) => k.cy);
  const left = Math.min(0, Math.max(BW - w * s, BW / 2 - cx * s));
  const top = Math.min(0, Math.max(BH - h * s, BH / 2 - cy * s));
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transformOrigin: "0 0", transform: `translate(${left}px, ${top}px) scale(${s})` }}>
        <Img src={staticFile(src)} style={{ width: w, height: h, display: "block" }} />
        <ScaleCtx.Provider value={s}>{children}</ScaleCtx.Provider>
      </div>
    </div>
  );
};

/** Highlight box in source px. */
export const Hi: React.FC<{ x: number; y: number; w: number; h: number; at: number; until?: number; color?: string; label?: string; below?: boolean }> = ({ x, y, w, h, at, until, color = C.accent, label, below }) => {
  const f = useCurrentFrame();
  const s = useScale();
  const t = p(f, at, 14) * (until ? 1 - p(f, until, 10) : 1);
  if (t <= 0.01) return null;
  const pad = 10 / s;
  return (
    <div style={{ position: "absolute", left: x - pad, top: y - pad, width: w + 2 * pad, height: h + 2 * pad, border: `${3.5 / s}px solid ${color}`, borderRadius: 14 / s, boxShadow: `0 0 ${46 / s}px ${color}77, inset 0 0 ${30 / s}px ${color}18`, opacity: t, transform: `scale(${0.97 + 0.03 * t})`, pointerEvents: "none" }}>
      {label && (
        <div style={{ position: "absolute", left: 0, [below ? "top" : "bottom"]: "100%", [below ? "marginTop" : "marginBottom"]: 10 / s, background: color, color: "#04241c", fontFamily: FONT, fontWeight: 700, fontSize: 26 / s, padding: `${6 / s}px ${16 / s}px`, borderRadius: 9 / s, whiteSpace: "nowrap" }}>{label}</div>
      )}
    </div>
  );
};

/** Dims everything except a hole (source px) — draws attention without boxes. */
export const Cover: React.FC<{ x: number; y: number; w: number; h: number; color: string; until: number; fade?: number }> = ({ x, y, w, h, color, until, fade = 10 }) => {
  const f = useCurrentFrame();
  const o = 1 - p(f, until, fade);
  if (o <= 0.01) return null;
  return <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: color, opacity: o }} />;
};

export const Cursor: React.FC<{ path: Array<{ f: number; x: number; y: number }>; click?: number }> = ({ path, click }) => {
  const f = useCurrentFrame();
  const s = useScale();
  const xs = path.map((k) => k.f);
  const x = interpolate(f, xs, path.map((k) => k.x), { ...clampX, easing: inOut });
  const y = interpolate(f, xs, path.map((k) => k.y), { ...clampX, easing: inOut });
  const r = click === undefined ? 0 : p(f, click, 18, Easing.out(Easing.quad));
  const sz = 38 / s;
  const down = click !== undefined && f >= click && f < click + 5 ? 0.88 : 1;
  const vis = f >= path[0]!.f ? Math.min(1, (f - path[0]!.f) / 8) : 0;
  const rad = (16 + 70 * r) / s;
  return (
    <>
      {click !== undefined && r > 0 && r < 1 && <div style={{ position: "absolute", left: x - rad, top: y - rad, width: rad * 2, height: rad * 2, borderRadius: "50%", border: `${4 / s}px solid ${C.accent}`, opacity: 1 - r, zIndex: 49 }} />}
      <div style={{ position: "absolute", left: x, top: y, width: sz, height: sz, opacity: vis, zIndex: 50, transform: `scale(${down})`, transformOrigin: "0 0" }}>
        <svg viewBox="0 0 24 24" width={sz} height={sz} style={{ filter: "drop-shadow(0 3px 6px rgba(0,0,0,.55))" }}>
          <path d="M3 2 L3 19 L8 14.5 L11.5 22 L14.5 20.6 L11 13.2 L18 13 Z" fill="#fff" stroke="#0b0f14" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </div>
    </>
  );
};

// ── captions + scene shell ───────────────────────────────────────────────────
const Captions: React.FC<{ text: string; d: number }> = ({ text, d }) => {
  const f = useCurrentFrame();
  const parts = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const total = parts.reduce((a, s) => a + s.length, 0);
  let acc = 0;
  const segs = parts.map((s) => {
    const a = acc / total, b = (acc + s.length) / total;
    acc += s.length;
    return { s: s.trim(), from: LEAD + a * d * FPS, to: LEAD + b * d * FPS };
  });
  const cur = segs.find((g) => f >= g.from - 2 && f < g.to + 4);
  if (!cur) return null;
  const o = Math.min(p(f, cur.from - 2, 8), 1 - p(f, cur.to - 2, 6));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 26, display: "flex", justifyContent: "center", opacity: o, zIndex: 100 }}>
      <div style={{ maxWidth: 1560, textAlign: "center", fontFamily: FONT, fontSize: 31, lineHeight: 1.32, color: "#fff", background: "rgba(8,11,16,.78)", padding: "11px 26px", borderRadius: 14, border: "1px solid rgba(255,255,255,.07)", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>{cur.s}</div>
    </div>
  );
};

export const Shell: React.FC<{ scene: SceneInfo; children: React.ReactNode; captions?: boolean }> = ({ scene, children, captions = true }) => {
  const f = useCurrentFrame();
  const fade = Math.min(p(f, 0, 9, lin), 1 - p(f, scene.frames - 9, 9, lin));
  return (
    <AbsoluteFill style={{ opacity: fade, fontFamily: FONT, color: C.text }}>
      <Bg />
      {children}
      <Sequence from={LEAD}><Audio src={staticFile(`audio/${scene.id}.mp3`)} /></Sequence>
      {captions && <Captions text={scene.text} d={scene.d} />}
    </AbsoluteFill>
  );
};

export const Pill: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({ children, color = C.accent, style }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: FONT, fontWeight: 700, fontSize: 22, letterSpacing: 1.5, color, border: `1px solid ${color}88`, background: `${color}1a`, padding: "6px 16px", borderRadius: 999, ...style }}>{children}</span>
);
