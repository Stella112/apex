// Risk policy schema (CLAUDE.md §6.3). USD/percent limits are decimal strings.
import { DEFAULT_POLICY_JSON } from "@apex/config";
import { z } from "zod";

const decStr = z.string().regex(/^\d+(\.\d+)?$/, "non-negative decimal string");

export const PolicySchema = z.object({
  maxLeverage: z.number().int().min(1).max(100),
  maxPositionNotionalUsd: decStr,
  maxPortfolioNotionalUsd: decStr,
  maxSingleMarketConcentrationPct: decStr,
  minLiquidationDistancePct: decStr,
  allowedClasses: z.array(z.enum(["crypto", "equity", "index", "commodity", "fx"])),
  blockedSymbols: z.array(z.string()),
  weekend: z.object({
    maxLeverageWhenUnderlyingClosed: z.number().int().min(1).max(100),
    blockNewPositionsWhenUnderlyingClosed: z.boolean(),
  }),
  maxActionsPerHour: z.number().int().min(0),
  requireHumanConfirm: z.boolean(),
}).strict();

export type Policy = z.infer<typeof PolicySchema>;

export const DEFAULT_POLICY: Policy = PolicySchema.parse(DEFAULT_POLICY_JSON);

/** Validate a partial update merged over a base policy. Throws with zod issues on invalid input. */
export function mergePolicy(base: Policy, patch: unknown): Policy {
  const p = z.object({}).passthrough().parse(patch) as Record<string, unknown>;
  const weekend = p.weekend && typeof p.weekend === "object" ? { ...base.weekend, ...(p.weekend as object) } : base.weekend;
  return PolicySchema.parse({ ...base, ...p, weekend });
}
