// Apex PAPER ledger (CLAUDE.md §6.4: "PAPER: simulates the fill"). Isolated positions only; margin and
// liquidation follow strike-calculations so PAPER numbers behave like Strike's. Persisted as JSON.
import { PAPER_START_BALANCE_USD } from "@apex/config";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type MarketMath, type PositionInput, accountLiquidations } from "./margin.js";
import { D, dec } from "./money.js";
import type { Side } from "./referee.js";

export interface PaperOrder {
  id: string;
  symbol: string;
  side: Side;
  type: "stop";
  size: string;
  stopPrice: string;
  reduceOnly: true;
  status: "resting" | "triggered" | "canceled";
  createdAt: string;
}

export interface PaperFill {
  ts: string;
  symbol: string;
  side: Side;
  size: string;
  price: string;
  fee: string;
  realizedPnl: string;
  reason: string;
}

export interface PaperState {
  version: 1;
  walletBalance: string;
  positions: PositionInput[];
  orders: PaperOrder[];
  fills: PaperFill[];
}

export const emptyPaper = (): PaperState => ({ version: 1, walletBalance: PAPER_START_BALANCE_USD, positions: [], orders: [], fills: [] });

export function loadPaper(file: string): PaperState {
  if (!existsSync(file)) return emptyPaper();
  return JSON.parse(readFileSync(file, "utf8")) as PaperState;
}

export function savePaper(file: string, s: PaperState): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, file);
}

const isoSum = (s: PaperState) => s.positions.reduce((a, p) => a.add(dec(p.iso_balance)), new D(0));
export const paperFree = (s: PaperState) => dec(s.walletBalance).sub(isoSum(s));

export class PaperError extends Error {}

/** Open/increase an isolated position. Margin = ceil(size·price/leverage, cents); taker fee from wallet. */
export function paperOpen(s: PaperState, symbol: string, side: Side, size: string, price: string, leverage: number, feeRate: string, ts: string): PaperState {
  const sz = dec(size), px = dec(price);
  const signed = side === "buy" ? sz : sz.neg();
  const existing = s.positions.find((p) => p.symbol === symbol);
  if (existing && dec(existing.size).isPos() !== signed.isPos()) throw new PaperError("PAPER: opposite-side open on an existing position is not supported; close it first");
  const margin = sz.mul(px).div(existing ? existing.leverage : leverage).toDecimalPlaces(2, D.ROUND_CEIL);
  const fee = sz.mul(px).mul(dec(feeRate)).toDecimalPlaces(8, D.ROUND_HALF_EVEN);
  if (paperFree(s).lt(margin.add(fee))) throw new PaperError(`PAPER: insufficient free balance (${paperFree(s).toFixed(2)}) for margin ${margin} + fee ${fee}`);
  const positions = s.positions.filter((p) => p.symbol !== symbol);
  if (existing) {
    const old = dec(existing.size);
    const newSize = old.add(signed);
    const entry = old.abs().mul(dec(existing.entry_price)).add(sz.mul(px)).div(newSize.abs());
    positions.push({ ...existing, size: newSize.toString(), entry_price: entry.toString(), iso_balance: dec(existing.iso_balance).add(margin).toString() });
  } else {
    positions.push({ symbol, size: signed.toString(), entry_price: px.toString(), leverage, margin_mode: "isolated", iso_balance: margin.toString() });
  }
  return {
    ...s,
    walletBalance: dec(s.walletBalance).sub(fee).toString(),
    positions,
    fills: [...s.fills, { ts, symbol, side, size, price, fee: fee.toString(), realizedPnl: "0", reason: "open" }],
  };
}

/** Reduce-only close at `price`; isolated margin released pro rata; realized PnL and fee hit the wallet. */
export function paperClose(s: PaperState, symbol: string, side: Side, size: string, price: string, feeRate: string, ts: string, reason: string): PaperState {
  const p = s.positions.find((x) => x.symbol === symbol);
  if (!p) throw new PaperError(`PAPER: no ${symbol} position`);
  const cur = dec(p.size);
  const closing: Side = cur.isPos() ? "sell" : "buy";
  if (side !== closing) throw new PaperError("PAPER: reduce-only order on the wrong side");
  const qty = D.min(dec(size), cur.abs());
  const px = dec(price);
  const realized = px.sub(dec(p.entry_price)).mul(cur.isPos() ? qty : qty.neg());
  const fee = qty.mul(px).mul(dec(feeRate)).toDecimalPlaces(8, D.ROUND_HALF_EVEN);
  const remaining = cur.abs().sub(qty);
  const positions = s.positions.filter((x) => x.symbol !== symbol);
  if (remaining.gt(0)) {
    const iso = dec(p.iso_balance).mul(remaining).div(cur.abs()).toDecimalPlaces(2, D.ROUND_CEIL);
    positions.push({ ...p, size: (cur.isPos() ? remaining : remaining.neg()).toString(), iso_balance: iso.toString() });
  }
  return {
    ...s,
    walletBalance: dec(s.walletBalance).add(realized).sub(fee).toString(),
    positions,
    orders: remaining.gt(0) ? s.orders : s.orders.map((o) => (o.symbol === symbol && o.status === "resting" ? { ...o, status: "canceled" as const } : o)),
    fills: [...s.fills, { ts, symbol, side, size: qty.toString(), price: px.toString(), fee: fee.toString(), realizedPnl: realized.toString(), reason }],
  };
}

export function paperAddStop(s: PaperState, o: PaperOrder): PaperState {
  return { ...s, orders: [...s.orders, o] };
}

export function paperCancel(s: PaperState, id: string): PaperState {
  if (!s.orders.some((o) => o.id === id && o.status === "resting")) throw new PaperError(`PAPER: no resting order ${id}`);
  return { ...s, orders: s.orders.map((o) => (o.id === id ? { ...o, status: "canceled" as const } : o)) };
}

export function paperIsoAdd(s: PaperState, symbol: string, amount: string): PaperState {
  const p = s.positions.find((x) => x.symbol === symbol);
  if (!p) throw new PaperError(`PAPER: no ${symbol} position`);
  if (paperFree(s).lt(dec(amount))) throw new PaperError(`PAPER: insufficient free balance for isoMargin add ${amount}`);
  return { ...s, positions: s.positions.map((x) => (x.symbol === symbol ? { ...x, iso_balance: dec(x.iso_balance).add(dec(amount)).toString() } : x)) };
}

/** Trigger resting paper stops whose condition is met by the current mark (fills at mark, labeled PAPER). */
export function paperCheckStops(s: PaperState, marks: Record<string, string>, takerRate: string, ts: string): PaperState {
  let out = s;
  for (const o of s.orders) {
    if (o.status !== "resting") continue;
    const m = marks[o.symbol];
    if (!m) continue;
    const hit = o.side === "sell" ? dec(m).lte(dec(o.stopPrice)) : dec(m).gte(dec(o.stopPrice));
    if (!hit) continue;
    out = { ...out, orders: out.orders.map((x) => (x.id === o.id ? { ...x, status: "triggered" as const } : x)) };
    if (out.positions.some((p) => p.symbol === o.symbol)) out = paperClose(out, o.symbol, o.side, o.size, m, takerRate, ts, `stop ${o.id} triggered`);
  }
  return out;
}

/** Positions with Apex-computed liquidation prices (strike-calculations, isolated profiles). */
export function paperPositionsWithLiq(s: PaperState, markets: Record<string, MarketMath>) {
  const have = s.positions.filter((p) => markets[p.symbol]);
  const liq = accountLiquidations(have, markets, dec(s.walletBalance));
  return have.map((p) => {
    const l = liq.find((x) => x.symbol === p.symbol)!;
    return { ...p, liquidation_price: l.lp.toString(), upnl: l.derived.upnl.toString(), mark: l.mark };
  });
}
