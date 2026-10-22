// Phase 4 gate: weekend report for every TradFi market (read-only), plus a positions section.
import { apexFromEnv } from "./env.js";
const apex = apexFromEnv();
const source = (process.argv[2] as "own" | "paper" | "vault" | undefined) ?? (apex.hasKeys ? "own" : "vault");
const r = await apex.weekendRiskReport(source);
console.log(`Weekend risk report ${r.asOf} — mode ${r.mode}; positions: ${r.positionsLabel}`);
console.log("symbol".padEnd(12), "class".padEnd(9), "under".padEnd(8), "h→open".padStart(7), "window".padStart(7), "method".padEnd(10), "n".padStart(3), "σ1h%".padStart(6), "worstL%".padStart(8), "P(−5%)".padStart(7), "P(−10%)".padStart(8), " flags");
for (const m of r.markets) {
  console.log(m.symbol.padEnd(12), m.class.padEnd(9), m.underlying.padEnd(8), String(m.hoursUntilNextOpen ?? "-").padStart(7), String(m.windowHours ?? "-").padStart(7), m.method.padEnd(10), String(m.samples).padStart(3), String(m.sigmaHourlyPct ?? "-").padStart(6), String(m.worstAdverseLongPct ?? "-").padStart(8), String(m.pMove5Long ?? "-").padStart(7), String(m.pMove10Long ?? "-").padStart(8), "", m.flags.join(","));
}
const bands: Record<string, number> = {};
for (const p of r.positions) bands[p.band] = (bands[p.band] ?? 0) + 1;
console.log(`\nPositions (${r.positionsLabel}): ${r.positions.length}; bands ${JSON.stringify(bands)}`);
for (const p of r.positions.filter((x) => x.band !== "N/A").slice(0, 12)) console.log(`  ${p.symbol.padEnd(12)} ${p.side.padEnd(5)} liqDist ${p.liquidationDistancePct ?? "none"}% p_gap ${p.pGapPct}% ${p.band} (${p.method}, n=${p.samples}) ${p.flags.join(",")}`);
console.log(`decision log seq ${r.logSeq}`);
