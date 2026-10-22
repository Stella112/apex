// PAPER demo seed: opens two paper positions through the normal propose → referee → confirm → execute
// flow on live Strike prices, then runs the Weekend Shield on them. Never sends anything to Strike.
import { apexFromEnv } from "./env.js";

const apex = apexFromEnv();
if (apex.mode !== "paper") throw new Error("demo-seed runs in PAPER mode only");
for (const [symbol, notionalUsd] of [["NVDA-USD", "450"], ["SKHYNIX-USD", "450"]] as const) {
  const { proposal, circuit } = await apex.proposeTrade({ symbol, side: "buy", notionalUsd, leverage: 3, orderType: "market" }, "paper");
  console.log(`${symbol}: proposal ${proposal.id} ${proposal.verdict.decision} — ${proposal.summary}; liq ${circuit.liquidation.distancePct.value}% away`);
  if (proposal.verdict.decision !== "APPROVE") {
    console.log("  blocked:", proposal.verdict.violations.map((v) => `${v.id} ${v.message}`).join("; "));
    continue;
  }
  const ex = await apex.executeProposal(proposal.id, true);
  console.log(`  execute → ${ex.status} [${ex.label}] log #${ex.logSeq}`);
}
const risk = await apex.positionsWithRisk("paper");
for (const p of risk.positions) console.log(`PAPER ${p.symbol} ${p.side} ${p.size} liq ${p.liquidationPrice} (${p.liquidationDistancePct}%) p_gap ${p.pGapPct}% ${p.band} (${p.method}, n=${p.samples}) suggestions: ${p.suggestions.length}`);
const prot = await apex.proposeProtection("SKHYNIX-USD", "protective_stop", "paper");
for (const p of prot.proposals) {
  console.log(`protect: ${p.summary} → ${p.verdict.decision}`);
  const ex = await apex.executeProposal(p.id, true);
  console.log(`  execute → ${ex.status} [${ex.label}] log #${ex.logSeq}`);
}
console.log("verify_log:", JSON.stringify(apex.verifyLog()));
