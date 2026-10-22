// Loads fresh inputs for Circuit from Strike (read-only). Each response keeps its own fetchedAt.
import { getAccount, getBalances, getPositions } from "./account.js";
import type { AccountView, CircuitData, GapInfo } from "./circuit.js";
import type { StrikeClient } from "./http.js";
import { getDepth, getFeeTiers, getMarkets } from "./market.js";
import type { Mode } from "./referee.js";
import type { MarketRegistry } from "./registry.js";
import type { FeeTiers } from "./schemas.js";

/** Reads the user's own Strike account (needs API keys). LIVE data. */
export async function loadLiveAccount(client: StrikeClient): Promise<AccountView> {
  const [acct, pos, bal] = await Promise.all([getAccount(client), getPositions(client), getBalances(client)]);
  const fetchedAt = Math.min(acct.fetchedAt, pos.fetchedAt, bal.fetchedAt);
  const settings = acct.data.symbol_settings;
  const def = acct.data.default_margin_mode === "isolated" ? "isolated" : "cross";
  return {
    source: "LIVE",
    walletBalance: bal.data[0]!.walletBalance,
    positions: pos.data.positions,
    marginModeFor: (s) => (settings[s]?.margin_mode === "isolated" ? "isolated" : settings[s]?.margin_mode === "cross" ? "cross" : def),
    fetchedAt,
  };
}

let feeCache: { data: FeeTiers; at: number } | undefined;

export interface LoadOptions {
  mode: Mode;
  liveEnvEnabled: boolean;
  account: AccountView | null;
  actionsInLastHour: number;
  gap?: GapInfo;
  needDepth?: boolean;
  now?: () => number;
}

export async function loadCircuitData(client: StrikeClient, registry: MarketRegistry, symbol: string, o: LoadOptions): Promise<CircuitData> {
  const now = o.now ?? Date.now;
  if (!registry.current || now() - registry.current.fetchedAt > 60_000) await registry.load();
  const [markets, depth] = await Promise.all([
    getMarkets(client),
    o.needDepth === false ? Promise.resolve(null) : getDepth(client, symbol).catch(() => null),
  ]);
  // Fee schedule changes rarely; cache for 10 minutes (fees are labeled with their source either way).
  if (!feeCache || now() - feeCache.at > 600_000) {
    const ft = await getFeeTiers(client).catch(() => null);
    if (ft) feeCache = { data: ft.data, at: ft.fetchedAt };
  }
  return {
    now: now(),
    mode: o.mode,
    liveEnvEnabled: o.liveEnvEnabled,
    market: registry.get(symbol),
    markets: markets.data.markets,
    marketsFetchedAt: markets.fetchedAt,
    depth: depth?.data ?? null,
    depthFetchedAt: depth?.fetchedAt ?? null,
    feeTiers: feeCache?.data ?? null,
    account: o.account,
    actionsInLastHour: o.actionsInLastHour,
    ...(o.gap ? { gap: o.gap } : {}),
  };
}
