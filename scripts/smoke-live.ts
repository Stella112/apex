// Read-only live smoke test (CLAUDE.md §11). Never writes. Prints live markets and, with keys,
// the account's positions; without keys, the SLP vault's positions via the public vault_id selector.
import "dotenv/config";
import {
  MarketRegistry, StrikeClient, type StrikeEnv, getAccount, getPositions, getProtocolVaults, parseApiWalletKey,
} from "@apex/core";

const env = (process.env.STRIKE_ENV ?? "mainnet") as StrikeEnv;
const pub = process.env.STRIKE_API_PUBLIC_KEY?.trim();
const priv = process.env.STRIKE_API_PRIVATE_KEY?.trim();
const key = pub && priv ? parseApiWalletKey(pub, priv) : undefined;
const client = new StrikeClient({ env, key });

const fmt = (ms: number | null) => (ms === null ? "-" : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z");

const reg = new MarketRegistry(client);
const snap = await reg.load();
console.log(`LIVE markets on ${env}: ${snap.markets.length} (fetched ${new Date(snap.fetchedAt).toISOString()})`);
console.log("symbol".padEnd(13), "class".padEnd(10), "perp".padEnd(8), "underlying".padEnd(10), "next open".padEnd(18), "mark".padStart(16), "fund/h".padStart(12), " notes");
for (const m of snap.markets) {
  const notes = m.notes.map((n) => n.split(":")[0]).join(",");
  console.log(
    m.symbol.padEnd(13), m.class.padEnd(10), m.perpStatus.padEnd(8), m.sessionState.underlying.padEnd(10),
    fmt(m.sessionState.nextOpen).padEnd(18), m.stats.markPrice.slice(0, 16).padStart(16), m.stats.fundingRateHourly.slice(0, 12).padStart(12), "", notes,
  );
}

if (key) {
  const acct = await getAccount(client);
  const pos = await getPositions(client);
  console.log(`\nLIVE account ${acct.data.account_id}: margin_balance ${acct.data.margin_balance}, available ${acct.data.available_balance}`);
  console.log(`LIVE positions: ${pos.data.count}`);
  for (const p of pos.data.positions) console.log(`  ${p.symbol} ${p.margin_mode} ${p.leverage}x size ${p.size} entry ${p.entry_price} liq ${p.liquidation_price}`);
} else {
  const vaultId = process.env.VAULT_ID?.trim() || (await getProtocolVaults(client)).data.vaults[0]?.vault_id;
  if (!vaultId) throw new Error("no vault id found");
  const pos = await getPositions(client, { vaultId });
  console.log(`\nNo API keys: showing LIVE public read-only positions of vault ${vaultId} (NOT your account): ${pos.data.count}`);
  for (const p of pos.data.positions.slice(0, 8)) console.log(`  ${p.symbol.padEnd(12)} ${p.margin_mode} ${p.leverage}x size ${p.size.slice(0, 14)} entry ${p.entry_price} liq ${p.liquidation_price.slice(0, 14)}`);
}
