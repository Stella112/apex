// Live fair-value bands for every equity/index perp (read-only, ESTIMATE).
import { apexFromEnv } from "./env.js";
const apex = apexFromEnv();
const ms = (await apex.markets()).filter((m) => m.class === "equity" || m.class === "index");
for (const m of ms) {
  const f = await apex.fairValue(m.symbol);
  console.log(m.symbol.padEnd(12), f.status.padEnd(17), `β ${f.beta ?? "-"} R² ${f.r2 ?? "-"} n=${f.samples}`.padEnd(26), f.status === "OK" ? `implied ${f.implied} band ${f.bandLow}–${f.bandHigh} (±${f.bandHalfWidthPct}%) mark ${f.mark} dev ${f.deviationPct}%` : f.note);
}
