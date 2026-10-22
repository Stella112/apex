import * as ed from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { getAccount, getPositions } from "../src/account.js";
import { MissingKeysError, StrikeApiError, StrikeSchemaError } from "../src/errors.js";
import { StrikeClient, buildQuery } from "../src/http.js";
import { getDepth, getKlines, getMarketStats } from "../src/market.js";
import { Positions, ServerTime } from "../src/schemas.js";
import { parseApiWalletKey, signingMessage } from "../src/signing.js";
import { fixture } from "./fixtures.js";

const SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const PUB = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

interface Call { url: string; init: RequestInit }

function fakeFetch(routes: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const r = routes(url, init ?? {});
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { impl, calls };
}

const headersOf = (c: Call) => c.init.headers as Record<string, string>;

describe("buildQuery", () => {
  it("keeps insertion order and drops undefined", () => {
    expect(buildQuery({ symbol: "BTC-USD", limit: undefined, interval: "1h" })).toBe("?symbol=BTC-USD&interval=1h");
    expect(buildQuery({})).toBe("");
  });
});

describe("StrikeClient", () => {
  it("public market calls go to /price and carry no auth headers", async () => {
    const f = fakeFetch(() => ({ status: 200, body: fixture("depth_NVDA-USD") }));
    const key = parseApiWalletKey(PUB, SEED);
    const c = new StrikeClient({ env: "mainnet", key, fetchImpl: f.impl });
    const res = await getDepth(c, "NVDA-USD");
    expect(f.calls[0]!.url).toBe("https://api.strikefinance.org/price/v2/depth?symbol=NVDA-USD");
    expect(Object.keys(headersOf(f.calls[0]!)).some((h) => h.startsWith("X-API-Wallet"))).toBe(false);
    expect(res.data.bids.length).toBeGreaterThan(0);
  });

  it("maps {code,msg} and {error} bodies to StrikeApiError", async () => {
    const f1 = fakeFetch(() => ({ status: 400, body: { code: "INVALID_SYMBOL", msg: "symbol not found" } }));
    const e1 = await getDepth(new StrikeClient({ env: "mainnet", fetchImpl: f1.impl }), "NOPE").catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(StrikeApiError);
    expect((e1 as StrikeApiError).code).toBe("INVALID_SYMBOL");
    expect((e1 as StrikeApiError).apiMessage).toBe("symbol not found");

    const f2 = fakeFetch(() => ({ status: 404, body: { error: "market not found" } }));
    const e2 = await getMarketStats(new StrikeClient({ env: "mainnet", fetchImpl: f2.impl }), "NOPE").catch((e: unknown) => e);
    expect((e2 as StrikeApiError).status).toBe(404);
    expect((e2 as StrikeApiError).apiMessage).toBe("market not found");
  });

  it("flags only key-invalid 401s as keyInvalid", () => {
    expect(new StrikeApiError(401, "u", undefined, "authentication failed", null).keyInvalid).toBe(true);
    expect(new StrikeApiError(401, "u", undefined, "signature expired or invalid timestamp", null).keyInvalid).toBe(false);
  });

  it("fails closed on an unexpected response shape", async () => {
    const f = fakeFetch(() => ({ status: 200, body: { positions: "nope" } }));
    const c = new StrikeClient({ env: "mainnet", fetchImpl: f.impl });
    await expect(c.publicGet("/v2/positions", { vault_id: "v" }, Positions)).rejects.toBeInstanceOf(StrikeSchemaError);
  });

  it("does not retry: one failing call = one request", async () => {
    const f = fakeFetch(() => ({ status: 503, body: { error: "service unavailable" } }));
    const c = new StrikeClient({ env: "mainnet", fetchImpl: f.impl });
    await expect(getDepth(c, "BTC-USD")).rejects.toBeInstanceOf(StrikeApiError);
    expect(f.calls.length).toBe(1);
  });

  it("signs the exact path+query and body it sends, 1 s behind server time", async () => {
    const serverMs = 1_792_697_286_000;
    const f = fakeFetch((url) =>
      url.endsWith("/v2/time") ? { status: 200, body: { serverTime: serverMs } } : { status: 200, body: { count: 0, positions: [] } },
    );
    const key = parseApiWalletKey(PUB, SEED);
    const c = new StrikeClient({ env: "mainnet", key, fetchImpl: f.impl, now: () => serverMs - 5000, nonce: () => "11111111-2222-4333-8444-555555555555" });
    await getPositions(c, {}, "BTC-USD");
    const call = f.calls[1]!;
    expect(call.url).toBe("https://api.strikefinance.org/v2/positions?symbol=BTC-USD");
    const h = headersOf(call);
    expect(h["X-API-Wallet-Timestamp"]).toBe(String(serverMs / 1000 - 1));
    const msg = signingMessage("GET", "/v2/positions?symbol=BTC-USD", Number(h["X-API-Wallet-Timestamp"]), h["X-API-Wallet-Nonce"]!, undefined);
    expect(ed.verify(hexToBytes(h["X-API-Wallet-Signature"]!), utf8ToBytes(msg), hexToBytes(PUB))).toBe(true);
  });

  it("hashes the exact serialized body on writes", async () => {
    const f = fakeFetch((url) => (url.endsWith("/v2/time") ? { status: 200, body: { serverTime: 1_792_697_286_000 } } : { status: 200, body: { serverTime: 1 } }));
    const key = parseApiWalletKey(PUB, SEED);
    const c = new StrikeClient({ env: "mainnet", key, fetchImpl: f.impl, now: () => 1_792_697_286_000 });
    const body = { symbol: "BTC-USD", side: "sell" };
    await c.authRequest("POST", "/v2/test", undefined, body, ServerTime);
    const call = f.calls[1]!;
    expect(call.init.body).toBe(JSON.stringify(body));
    const h = headersOf(call);
    const msg = signingMessage("POST", "/v2/test", Number(h["X-API-Wallet-Timestamp"]), h["X-API-Wallet-Nonce"]!, call.init.body as string);
    expect(ed.verify(hexToBytes(h["X-API-Wallet-Signature"]!), utf8ToBytes(msg), hexToBytes(PUB))).toBe(true);
  });

  it("account reads without keys: vault selector goes out unsigned, own-account read throws", async () => {
    const f = fakeFetch(() => ({ status: 200, body: fixture("account_vault_slp") }));
    const c = new StrikeClient({ env: "mainnet", fetchImpl: f.impl });
    const res = await getAccount(c, { vaultId: "3fd3ab0b-318b-4f99-9ad6-66e9e917bea8" });
    expect(f.calls[0]!.url).toBe("https://api.strikefinance.org/v2/account?vault_id=3fd3ab0b-318b-4f99-9ad6-66e9e917bea8");
    expect(res.data.account_id).toBe("vault_3fd3ab0b");
    expect(() => getAccount(c)).toThrow(MissingKeysError);
  });

  it("klines: parses rows and drops rows older than startTime", async () => {
    const rows = fixture("klines_NVDA-USD_1h_mark") as unknown[][];
    const f = fakeFetch(() => ({ status: 200, body: rows }));
    const c = new StrikeClient({ env: "mainnet", fetchImpl: f.impl });
    const start = rows[10]![0] as number;
    const res = await getKlines(c, { symbol: "NVDA-USD", interval: "1h", priceType: "mark", startTime: start });
    expect(res.data.length).toBe(rows.length - 10);
    expect(res.data[0]!.openTime).toBe(start);
    expect(f.calls[0]!.url).toContain("interval=1h");
    await expect(getKlines(c, { symbol: "NVDA-USD", interval: "1h", limit: 1501 })).rejects.toThrow();
  });
});
