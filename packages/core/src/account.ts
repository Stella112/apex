// Account reads (FlexibleAuth). Source: ref/strike-finance-skills/openapi/user-api.yaml, trade-api.yaml
// (`/v2/openOrders`), skills/strike-auth (route groups). With keys: signed as the API wallet.
// Without keys: only a public `vault_id` selector is allowed (read-only display, CLAUDE.md §6.8).
import { MissingKeysError } from "./errors.js";
import type { Query, StrikeClient } from "./http.js";
import { Account, Balances, HistoryOrders, OpenOrders, Positions } from "./schemas.js";
import type { z } from "zod";

export interface AccountScope {
  /** Read a vault account (query param, CLAUDE.md §4.4). */
  vaultId?: string;
  /** Sign the vault read as its leader. Default: vault reads go out unsigned (public selector). */
  asLeader?: boolean;
}

function read<S extends z.ZodType>(c: StrikeClient, path: string, query: Query, scope: AccountScope, schema: S) {
  const q: Query = { ...query, vault_id: scope.vaultId };
  if (scope.vaultId && !scope.asLeader) return c.publicGet(path, q, schema);
  if (c.hasKeys) return c.authRequest("GET", path, q, undefined, schema);
  throw new MissingKeysError();
}

export const getAccount = (c: StrikeClient, scope: AccountScope = {}) => read(c, "/v2/account", {}, scope, Account);
export const getPositions = (c: StrikeClient, scope: AccountScope = {}, symbol?: string) =>
  read(c, "/v2/positions", { symbol }, scope, Positions);
export const getOpenOrders = (c: StrikeClient, scope: AccountScope = {}, symbol?: string) =>
  read(c, "/v2/openOrders", { symbol }, scope, OpenOrders);
export const getOrderHistory = (c: StrikeClient, scope: AccountScope = {}, opts: { symbol?: string; limit?: number } = {}) =>
  read(c, "/v2/history/order", { symbol: opts.symbol, limit: opts.limit }, scope, HistoryOrders);
export const getBalances = (c: StrikeClient, scope: AccountScope = {}) => read(c, "/v2/balances", {}, scope, Balances);
