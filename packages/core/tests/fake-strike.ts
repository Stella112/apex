// Fixture-backed fake Strike for offline tests. Serves the real responses captured in fixtures/live/.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Apex } from "../src/service.js";
import { StrikeClient } from "../src/http.js";
import { parseApiWalletKey } from "../src/signing.js";
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
      case "/v2/credit/settings": body = fixture("credit_settings"); break;
      case "/v2/credit/collateral-assets": body = fixture("credit_collateral-assets"); break;
      case "/v2/vault/3fd3ab0b-318b-4f99-9ad6-66e9e917bea8": body = fixture("vault_slp"); break;
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

/** LIVE-mode fake: own account with one isolated NVDA long, accepting writes and reconciling. */
export function fakeLiveApex() {
  const SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
  const PUB = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
  const base = fakeFetch();
  const writes: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }> = [];
  const orders = new Map<string, number>();
  const ownPosition = {
    id: 1, symbol: "NVDA-USD", margin_mode: "isolated", leverage: 10, size: "2", entry_price: "212.00", iso_balance: "42.40",
    accumulated_funding_fees: "0", upnl: "0", maintenance_margin: "4.24", bankruptcy_price: "190.8", liquidation_price: "192.7272727",
    create_timestamp: FIXTURE_NOW - 3600_000, update_timestamp: FIXTURE_NOW - 60_000,
  };
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (method !== "GET") {
      writes.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers });
      const b = JSON.parse(String(init?.body ?? "{}")) as { client_order_id?: string; symbol?: string };
      if (url.pathname === "/v2/order") {
        orders.set(b.client_order_id!, 0);
        return new Response(JSON.stringify({ client_order_id: b.client_order_id, symbol: b.symbol, status: "pending", sequence_id: 1 }), { status: 201 });
      }
      return new Response(JSON.stringify({ error: "fake: unsupported write" }), { status: 400 });
    }
    if (url.pathname === "/v2/order") {
      const id = url.searchParams.get("client_order_id")!;
      const n = orders.get(id);
      if (n === undefined || n === 0) {
        if (n !== undefined) orders.set(id, 1);
        return new Response(JSON.stringify({ error: "order not found" }), { status: 404 });
      }
      return new Response(JSON.stringify({ ID: 77, ClientOrderID: id, Symbol: "NVDA-USD", CloseReason: "", Side: "sell", Status: "untriggered", Type: "stop", Size: "2", Filled: "0", StopPrice: "180" }), { status: 200 });
    }
    if (url.pathname === "/v2/positions" && !url.searchParams.get("vault_id")) {
      return new Response(JSON.stringify({ count: 1, positions: [ownPosition] }), { status: 200 });
    }
    if (url.pathname === "/v2/balances" && !url.searchParams.get("vault_id")) {
      return new Response(JSON.stringify([{ asset: "USDT", walletBalance: "1000", unrealizedPnl: "0", marginBalance: "1000", maintMargin: "4.24", positionInitialMargin: "42.4", availableBalance: "950", updateTime: FIXTURE_NOW }]), { status: 200 });
    }
    return base.impl(input, init);
  }) as typeof fetch;
  const t = FIXTURE_NOW;
  const client = new StrikeClient({ env: "mainnet", fetchImpl: impl, now: () => t, key: parseApiWalletKey(PUB, SEED) });
  const stateDir = join(mkdtempSync(join(tmpdir(), "apex-live-")), "logs");
  const apex = new Apex({ env: "mainnet", apexMode: "live", stateDir, logSigningKey: "44".repeat(32), client, now: () => t });
  return { apex, writes, ownPosition };
}
