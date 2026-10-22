// Strike REST client. Hosts: CLAUDE.md §4.1 / market-api.yaml `servers` (market data under /price).
// No automatic retries anywhere: reads fail closed and writes are not idempotent (CLAUDE.md §2.2).
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { MissingKeysError, StrikeApiError, StrikeNetworkError, StrikeSchemaError, parseErrorBody } from "./errors.js";
import { ServerTime } from "./schemas.js";
import { type ApiWalletKey, signHeaders } from "./signing.js";

export const HOSTS = {
  mainnet: "https://api.strikefinance.org",
  testnet: "https://api-v2-testnet.strikefinance.org",
} as const;
export type StrikeEnv = keyof typeof HOSTS;

export type Query = Record<string, string | number | boolean | undefined>;

export interface Fetched<T> {
  data: T;
  /** Local epoch ms when the response arrived — used for freshness checks (CLAUDE.md §6.2). */
  fetchedAt: number;
  url: string;
}

export interface ClientOptions {
  env: StrikeEnv;
  key?: ApiWalletKey;
  fetchImpl?: typeof fetch;
  now?: () => number;
  nonce?: () => string;
  timeoutMs?: number;
}

/** Builds `?a=1&b=2` in insertion order; the same string is sent and signed. */
export function buildQuery(q: Query | undefined): string {
  if (!q) return "";
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export class StrikeClient {
  readonly env: StrikeEnv;
  readonly host: string;
  private readonly key: ApiWalletKey | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly nonce: () => string;
  private readonly timeoutMs: number;
  private clockOffsetMs = 0;
  private clockSynced = false;

  constructor(opts: ClientOptions) {
    this.env = opts.env;
    this.host = HOSTS[opts.env];
    this.key = opts.key;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.nonce = opts.nonce ?? randomUUID;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  get hasKeys(): boolean {
    return this.key !== undefined;
  }

  /** Public market-data GET under /price. Never sends auth headers (strike-auth: FlexibleAuth note). */
  marketGet<S extends z.ZodType>(path: string, query: Query | undefined, schema: S): Promise<Fetched<z.infer<S>>> {
    return this.send("GET", `${this.host}/price`, path, query, undefined, schema, false);
  }

  /** Public GET on the main host (fee-tiers, credit, vaults, time; or FlexibleAuth reads with a public selector). */
  publicGet<S extends z.ZodType>(path: string, query: Query | undefined, schema: S): Promise<Fetched<z.infer<S>>> {
    return this.send("GET", this.host, path, query, undefined, schema, false);
  }

  /** Signed request with the API wallet. Body is serialized once and that exact string is hashed and sent. */
  async authRequest<S extends z.ZodType>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    query: Query | undefined,
    body: unknown,
    schema: S,
  ): Promise<Fetched<z.infer<S>>> {
    if (!this.key) throw new MissingKeysError();
    if (!this.clockSynced) await this.syncClock();
    return this.send(method, this.host, path, query, body, schema, true);
  }

  /** strike-auth "Validation rules": align with GET /v2/time so timestamps are never in the future. */
  async syncClock(): Promise<void> {
    const t0 = this.now();
    const res = await this.publicGet("/v2/time", undefined, ServerTime);
    const t1 = this.now();
    this.clockOffsetMs = res.data.serverTime - Math.round((t0 + t1) / 2);
    this.clockSynced = true;
  }

  /** Unix seconds, 1 s behind server time (strike-auth TypeScript example). */
  timestampSec(): number {
    return Math.floor((this.now() + this.clockOffsetMs - 1000) / 1000);
  }

  private async send<S extends z.ZodType>(
    method: string,
    base: string,
    path: string,
    query: Query | undefined,
    body: unknown,
    schema: S,
    signed: boolean,
  ): Promise<Fetched<z.infer<S>>> {
    const pathWithQuery = `${path}${buildQuery(query)}`;
    const url = `${base}${pathWithQuery}`;
    const bodyStr = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (bodyStr !== undefined) headers["Content-Type"] = "application/json";
    if (signed && this.key) {
      Object.assign(headers, signHeaders(this.key, { method, pathWithQuery, body: bodyStr, timestampSec: this.timestampSec(), nonce: this.nonce() }));
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, headers, body: bodyStr, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new StrikeNetworkError(url, e);
    }
    const fetchedAt = this.now();
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text.length ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body kept as text */
    }
    if (!res.ok) {
      const { code, message } = parseErrorBody(parsed);
      throw new StrikeApiError(res.status, url, code, message, parsed);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new StrikeSchemaError(url, result.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    return { data: result.data, fetchedAt, url };
  }
}
