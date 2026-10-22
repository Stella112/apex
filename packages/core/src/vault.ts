// Mandate Vault (CLAUDE.md §6.8, P2): a published mandate run as a PAPER vault. Every candidate passes
// Circuit + the Risk Referee with the mandate as policy; reasoning text is template-generated.
import { MANDATE_JSON } from "@apex/config";
import { z } from "zod";
import { D, type Dec, dec } from "./money.js";
import type { Policy } from "./policy.js";
import { PolicySchema } from "./policy.js";

const decStr = z.string().regex(/^\d+(\.\d+)?$/);

export const MandateSchema = z.object({
  name: z.string(),
  mode: z.literal("PAPER"),
  description: z.string(),
  allowedSymbols: z.array(z.string()).min(1),
  maxLeverage: z.number().int().min(1),
  maxPositionNotionalUsd: decStr,
  maxExposureUsd: decStr,
  maxDrawdownPct: decStr,
  maxActionsPerDay: z.number().int().min(0),
  minLiquidationDistancePct: decStr,
  weekend: z.object({ onlyTradeWhenUnderlyingClosed: z.boolean(), flatMinutesBeforeOpen: z.number().int().min(0) }),
  signal: z.object({ deviationMultipleOfHalfWidth: decStr, requireReliableBand: z.boolean() }),
  emergency: z.object({ flattenAllIfDrawdownPctAbove: decStr }),
  startingEquityUsd: decStr,
});
export type Mandate = z.infer<typeof MandateSchema>;

export const MANDATE: Mandate = MandateSchema.parse(MANDATE_JSON);

/** The mandate expressed as a Risk Referee policy. */
export function mandatePolicy(m: Mandate): Policy {
  return PolicySchema.parse({
    maxLeverage: m.maxLeverage,
    maxPositionNotionalUsd: m.maxPositionNotionalUsd,
    maxPortfolioNotionalUsd: m.maxExposureUsd,
    // Each position is capped at maxPositionNotional ≤ 1/3 of exposure; concentration is bounded by that.
    maxSingleMarketConcentrationPct: "100",
    minLiquidationDistancePct: m.minLiquidationDistancePct,
    allowedClasses: ["equity", "index"],
    blockedSymbols: [],
    // The mandate trades while the underlying is closed by design, so the closed-session cap equals its max.
    weekend: { maxLeverageWhenUnderlyingClosed: m.maxLeverage, blockNewPositionsWhenUnderlyingClosed: false },
    maxActionsPerHour: m.maxActionsPerDay,
    requireHumanConfirm: false,
  });
}

export interface VaultState {
  peakEquity: string;
  actions: string[]; // ISO timestamps of executed actions
}

export const initialVaultState = (m: Mandate): VaultState => ({ peakEquity: m.startingEquityUsd, actions: [] });

export function drawdownPct(equity: Dec, peak: Dec): Dec {
  return peak.gt(0) ? D.max(0, peak.sub(equity).div(peak).mul(100)) : new D(0);
}

export interface SignalInput {
  symbol: string;
  underlying: "open" | "closed" | "unknown";
  minutesToOpen: number | null;
  fvStatus: string;
  implied: string | null;
  halfWidthPct: string | null;
  mark: string;
}

export type Signal =
  | { kind: "none"; reason: string }
  | { kind: "enter"; side: "buy" | "sell"; reason: string; deviationPct: string; thresholdPct: string };

/** Reversion signal: underlying closed, reliable band, |mark − implied| > k × half-width. */
export function reversionSignal(s: SignalInput, m: Mandate): Signal {
  if (m.weekend.onlyTradeWhenUnderlyingClosed && s.underlying !== "closed") return { kind: "none", reason: `underlying ${s.underlying}` };
  if (s.minutesToOpen !== null && s.minutesToOpen <= m.weekend.flatMinutesBeforeOpen) return { kind: "none", reason: `underlying opens in ${s.minutesToOpen.toFixed(0)} min` };
  if (s.fvStatus !== "OK" || !s.implied || !s.halfWidthPct) return { kind: "none", reason: `fair value ${s.fvStatus.toLowerCase().replace(/_/g, " ")}` };
  const dev = dec(s.mark).div(dec(s.implied)).sub(1).mul(100);
  const threshold = dec(m.signal.deviationMultipleOfHalfWidth).mul(dec(s.halfWidthPct));
  if (dev.abs().lte(threshold)) return { kind: "none", reason: `mark ${dev.toFixed(3)}% from implied, inside ±${threshold.toFixed(3)}%` };
  return {
    kind: "enter",
    side: dev.isPos() ? "sell" : "buy",
    deviationPct: dev.toFixed(3),
    thresholdPct: threshold.toFixed(3),
    reason: `mark ${dev.toFixed(3)}% ${dev.isPos() ? "above" : "below"} implied ${s.implied}, beyond ${m.signal.deviationMultipleOfHalfWidth}× half-width (±${threshold.toFixed(3)}%): revert ${dev.isPos() ? "short" : "long"}`,
  };
}
