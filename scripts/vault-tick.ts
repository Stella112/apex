// One Mandate Vault evaluation on live Strike prices (PAPER fills only).
import { apexFromEnv } from "./env.js";
const apex = apexFromEnv();
const r = await apex.vaultTick();
for (const d of r.decisions) console.log(`${d.symbol.padEnd(11)} ${d.outcome.padEnd(10)} ${d.reasoning}`);
console.log(`\nPAPER equity $${r.status.equityUsd} (${r.status.returnPct}%), drawdown ${r.status.drawdownPct}%, positions ${r.status.positions.length}`);
