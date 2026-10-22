// Phase 0: call every public Strike endpoint Apex depends on and save the real
// responses to fixtures/live/. No auth headers are sent (strike-auth skill:
// a present X-API-Wallet-Public-Key turns any failure into a 401, even on public reads).
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Hosts: CLAUDE.md §4.1; market-api.yaml `servers` (market data under /price).
const HOSTS = {
  mainnet: "https://api.strikefinance.org",
  testnet: "https://api-v2-testnet.strikefinance.org",
} as const;
type Env = keyof typeof HOSTS;

const env = (process.env.STRIKE_ENV ?? "mainnet") as Env;
if (!(env in HOSTS)) throw new Error(`STRIKE_ENV must be mainnet|testnet, got ${env}`);

const OUT = join(process.cwd(), "fixtures", "live");
mkdirSync(OUT, { recursive: true });

interface Call { name: string; url: string }
interface Result { name: string; url: string; status: number | null; ok: boolean; xCache: string | null; bytes: number; error?: string; fetchedAt: string }

function calls(host: string, prefix = ""): Call[] {
  const p = `${host}/price`;
  return [
    { name: `${prefix}time`, url: `${host}/v2/time` },
    { name: `${prefix}exchangeInfo`, url: `${p}/v2/exchangeInfo` },
    { name: `${prefix}marketStats`, url: `${p}/v2/marketStats` },
    { name: `${prefix}markPrice`, url: `${p}/v2/markPrice` },
    { name: `${prefix}depth_BTC-USD`, url: `${p}/v2/depth?symbol=BTC-USD` },
    { name: `${prefix}depth_NVDA-USD`, url: `${p}/v2/depth?symbol=NVDA-USD` },
    { name: `${prefix}klines_NVDA-USD_1h_mark`, url: `${p}/v2/klines?symbol=NVDA-USD&interval=1h&priceType=mark&limit=1500` },
    { name: `${prefix}fee-tiers`, url: `${host}/v2/fee-tiers` },
    { name: `${prefix}credit_settings`, url: `${host}/v2/credit/settings` },
    { name: `${prefix}credit_collateral-assets`, url: `${host}/v2/credit/collateral-assets` },
    { name: `${prefix}vaults_protocol`, url: `${host}/v2/vaults?type=protocol` },
  ];
}

async function run(c: Call): Promise<{ result: Result; body: unknown }> {
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(c.url, { signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep raw text */ }
    writeFileSync(join(OUT, `${c.name}.json`), JSON.stringify(body, null, 2));
    return { result: { name: c.name, url: c.url, status: res.status, ok: res.ok, xCache: res.headers.get("x-cache"), bytes: text.length, fetchedAt }, body };
  } catch (e) {
    return { result: { name: c.name, url: c.url, status: null, ok: false, xCache: null, bytes: 0, error: String(e), fetchedAt }, body: null };
  }
}

const results: Result[] = [];
const bodies: Record<string, unknown> = {};
for (const c of calls(HOSTS[env])) {
  const { result, body } = await run(c);
  results.push(result); bodies[c.name] = body;
  console.log(`${result.ok ? "OK  " : "FAIL"} ${String(result.status).padEnd(4)} ${c.name.padEnd(28)} ${result.bytes}B ${result.error ?? ""}`);
}

// Follow-up: SLP vault detail (share_price). Vault id taken from the real list response.
const vaults = bodies["vaults_protocol"] as { vaults?: Array<{ id?: string; vault_id?: string; name?: string }> } | Array<{ id?: string }> | null;
const list = Array.isArray(vaults) ? vaults : vaults?.vaults ?? [];
const first = list[0] as { id?: string; vault_id?: string } | undefined;
const vid = first?.id ?? first?.vault_id;
if (vid) {
  const { result } = await run({ name: "vault_slp", url: `${HOSTS[env]}/v2/vault/${vid}` });
  results.push(result);
  console.log(`${result.ok ? "OK  " : "FAIL"} ${String(result.status).padEnd(4)} vault_slp (${vid}) ${result.bytes}B`);
} else {
  console.log("SKIP vault_slp: could not find a vault id in vaults_protocol response (inspect fixture)");
}

// Testnet probe: does testnet list TradFi markets? (VERIFICATION item)
if (env === "mainnet") {
  const { result } = await run({ name: "testnet_marketStats", url: `${HOSTS.testnet}/price/v2/marketStats` });
  results.push(result);
  console.log(`${result.ok ? "OK  " : "FAIL"} ${String(result.status).padEnd(4)} testnet_marketStats ${result.bytes}B`);
}

// Authenticated reads need Ed25519 signing (Phase 1). Recorded as skipped when no keys are present.
const hasKeys = Boolean(process.env.STRIKE_API_PUBLIC_KEY && process.env.STRIKE_API_PRIVATE_KEY);
console.log(hasKeys ? "NOTE keys present: account/positions reads run in Phase 1 smoke (signing lands there)" : "SKIP account/positions: no API wallet keys in .env");

writeFileSync(join(OUT, "_manifest.json"), JSON.stringify({ env, hasKeys, results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} calls OK on ${env}`);
