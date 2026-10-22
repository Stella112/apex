// Phase 3 gate: live Circuit report on NVDA-USD + live liquidation validation (read-only).
import "dotenv/config";
import {
  DEFAULT_POLICY, MarketRegistry, StrikeClient, type StrikeEnv, accountLiquidations, compareLiquidations, dec,
  getBalances, getMarkets, getPositions, getProtocolVaults, loadCircuitData, loadLiveAccount, parseApiWalletKey, runCircuit,
} from "@apex/core";

const env = (process.env.STRIKE_ENV ?? "mainnet") as StrikeEnv;
const pub = process.env.STRIKE_API_PUBLIC_KEY?.trim(), priv = process.env.STRIKE_API_PRIVATE_KEY?.trim();
const client = new StrikeClient({ env, key: pub && priv ? parseApiWalletKey(pub, priv) : undefined });
const reg = new MarketRegistry(client);
await reg.load();

const symbol = process.argv[2] ?? "NVDA-USD";
const account = client.hasKeys ? await loadLiveAccount(client) : null;
const data = await loadCircuitData(client, reg, symbol, { mode: "paper", liveEnvEnabled: false, account, actionsInLastHour: 0 });
const r = runCircuit({ symbol, side: "buy", notionalUsd: "1000", leverage: 10, orderType: "market", stopLoss: undefined, customMovePct: "12" }, data, DEFAULT_POLICY);
console.log(JSON.stringify(r, null, 1));

// Liquidation validation: own account with keys, else the SLP vault (public read-only).
const vaultId = (await getProtocolVaults(client)).data.vaults[0]!.vault_id;
const scope = client.hasKeys ? {} : { vaultId };
const [pos, bal, mk] = await Promise.all([getPositions(client, scope), getBalances(client, scope), getMarkets(client)]);
const mm = Object.fromEntries(Object.entries(mk.data.markets).map(([k, m]) => [k, { tiers: m.margin_tiers, quotePrec: m.quote_prec, mark: m.mark_price }]));
const checks = compareLiquidations(accountLiquidations(pos.data.positions, mm, dec(bal.data[0]!.walletBalance)), pos.data.positions);
const bad = checks.filter((c) => !c.match);
console.log(`\nLIQUIDATION CHECK (${client.hasKeys ? "own account" : `SLP vault ${vaultId}, public`}): ${checks.length - bad.length}/${checks.length} within 1%; max diff ${checks.reduce((m, c) => (c.diffPct && Number(c.diffPct) > m ? Number(c.diffPct) : m), 0)}%`);
for (const b of bad) console.log("  MISMATCH", b);
