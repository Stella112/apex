// LIVE trade writes and reconciliation. Paths, bodies and enums copied from
// ref/strike-finance-skills/openapi/trade-api.yaml (POST /v2/order, DELETE /v2/order/cancel,
// POST /v2/isoMargin, GET /v2/order). Writes are never retried (CLAUDE.md §2.2).
import { z } from "zod";
import type { StrikeClient } from "./http.js";
import { Positions } from "./schemas.js";

export const CreateOrderResponse = z.object({ client_order_id: z.string(), symbol: z.string(), status: z.string() });
export const CancelOrderResponse = z.object({ symbol: z.string() }).passthrough();
export const ModifyMarginResponse = z.object({ symbol: z.string(), request_id: z.string().optional() }).passthrough();

// GET /v2/order — PascalCase engine model (trade-api.yaml Order).
export const EngineOrder = z.object({
  ID: z.number().int(),
  ClientOrderID: z.string(),
  Symbol: z.string(),
  CloseReason: z.string().optional().default(""),
  Side: z.string(),
  Status: z.enum(["pending", "open", "filled", "canceled", "untriggered", "rejected", "expired"]),
  Type: z.string(),
  Size: z.string(),
  Filled: z.string(),
  StopPrice: z.string().optional(),
});
export type EngineOrder = z.infer<typeof EngineOrder>;

export interface StopOrderBody {
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "stop";
  size: string;
  stop_price: string;
  reduce_only: true;
}
export interface MarketCloseBody {
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market";
  size: string;
  reduce_only: true;
  slippage: string;
}

export const placeOrder = (c: StrikeClient, body: StopOrderBody | MarketCloseBody) =>
  c.authRequest("POST", "/v2/order", undefined, body, CreateOrderResponse);

/** DELETE with a required JSON body (spec: "The JSON body is required on this DELETE ... sign its hash"). */
export const cancelOrder = (c: StrikeClient, symbol: string, orderId: number) =>
  c.authRequest("DELETE", "/v2/order/cancel", undefined, { order_id: orderId, symbol }, CancelOrderResponse);

export const addIsoMargin = (c: StrikeClient, symbol: string, amount: string) =>
  c.authRequest("POST", "/v2/isoMargin", undefined, { symbol, amount, modify_type: "add" }, ModifyMarginResponse);

export const getOrderByClientId = (c: StrikeClient, symbol: string, clientOrderId: string) =>
  c.authRequest("GET", "/v2/order", { symbol, client_order_id: clientOrderId }, undefined, EngineOrder);

export interface Reconciled {
  status: EngineOrder["Status"] | "timeout" | "not_found";
  order?: EngineOrder;
  polls: number;
  elapsedMs: number;
}

const TERMINAL_OR_WORKING = new Set(["open", "untriggered", "filled", "canceled", "rejected", "expired"]);

/**
 * Poll GET /v2/order by client_order_id until the engine reports a non-pending status or `timeoutMs`
 * passes (CLAUDE.md §6.4: 20 s). The status reported is Strike's, never assumed.
 */
export async function reconcileOrder(
  c: StrikeClient,
  symbol: string,
  clientOrderId: string,
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<Reconciled> {
  const timeout = opts.timeoutMs ?? 20_000, interval = opts.intervalMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const start = now();
  let polls = 0;
  let last: EngineOrder | undefined;
  while (now() - start < timeout) {
    polls++;
    try {
      const r = await getOrderByClientId(c, symbol, clientOrderId);
      last = r.data;
      if (TERMINAL_OR_WORKING.has(r.data.Status)) return { status: r.data.Status, order: r.data, polls, elapsedMs: now() - start };
    } catch {
      // 404 while the engine has not indexed it yet; keep polling until timeout.
    }
    await sleep(interval);
  }
  return { status: last ? "timeout" : "not_found", ...(last ? { order: last } : {}), polls, elapsedMs: now() - start };
}

/** isoMargin results arrive on the user stream; without it, reconcile by re-reading the position. */
export async function reconcileIsoMargin(
  c: StrikeClient,
  symbol: string,
  before: string,
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<{ status: "applied" | "timeout"; isoBalance: string | null; polls: number }> {
  const timeout = opts.timeoutMs ?? 20_000, interval = opts.intervalMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const start = now();
  let polls = 0, iso: string | null = null;
  while (now() - start < timeout) {
    polls++;
    const r = await c.authRequest("GET", "/v2/positions", { symbol }, undefined, Positions).catch(() => null);
    iso = r?.data.positions.find((p) => p.symbol === symbol)?.iso_balance ?? null;
    if (iso !== null && iso !== before) return { status: "applied", isoBalance: iso, polls };
    await sleep(interval);
  }
  return { status: "timeout", isoBalance: iso, polls };
}
