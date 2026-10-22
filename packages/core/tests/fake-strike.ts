// Fixture-backed fake Strike for offline tests. Serves the real responses captured in fixtures/live/.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Apex } from "../src/service.js";
import { StrikeClient } from "../src/http.js";
import { fixture } from "./fixtures.js";

/** Thu 2026-10-22 ~15:28 ET, the fixture capture time (US session open). */
export const FIXTURE_NOW = 1_792_697_300_000;

export function fakeFetch(): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    const p = url.pathname.replace(/^\/price/, "");
    const sym = url.searchParams.get("symbol");
    const vault = url.searchParams.get("vault_id");
    let body: unknown;
    switch (p) {
      case "/v2/time": body = { serverTime: FIXTURE_NOW }; break;
      case "/v2/exchangeInfo": body = fixture("exchangeInfo"); break;
      case "/v2/marketStats": body = fixture("marketStats"); break;
      case "/v2/markPrice": body = fixture("markPrice"); break;
      case "/v2/depth": body = fixture(sym === "BTC-USD" ? "depth_BTC-USD" : "depth_NVDA-USD"); break;
      case "/v2/klines": body = fixture("klines_NVDA-USD_1h_mark"); break;
      case "/v2/fee-tiers": body = fixture("fee-tiers"); break;
      case "/v2/markets": body = fixture("markets"); break;
      case "/v2/vaults": body = fixture("vaults_protocol"); break;
      case "/v2/positions": body = vault ? fixture("positions_vault_slp") : { count: 0, positions: [] }; break;
      case "/v2/balances": body = fixture("balances_vault_slp"); break;
      case "/v2/account": body = fixture("account_vault_slp"); break;
      case "/v2/history/order": body = fixture("history_order_vault_slp_NVDA"); break;
      case "/v2/openOrders": body = fixture("openOrders_vault_slp_NVDA"); break;
      default: return new Response(JSON.stringify({ error: `fake: no route ${p}` }), { status: 404 });
    }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

export function fakeApex(opts: { now?: () => number; stateDir?: string } = {}) {
  let t = FIXTURE_NOW;
  const now = opts.now ?? (() => t);
  const f = fakeFetch();
  const client = new StrikeClient({ env: "mainnet", fetchImpl: f.impl, now });
  const stateDir = opts.stateDir ?? join(mkdtempSync(join(tmpdir(), "apex-state-")), "logs");
  const apex = new Apex({ env: "mainnet", apexMode: "paper", stateDir, logSigningKey: "33".repeat(32), client, now });
  return { apex, calls: f.calls, advance: (ms: number) => { t += ms; }, stateDir };
}
