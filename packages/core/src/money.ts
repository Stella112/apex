// All money math goes through decimal.js (CLAUDE.md §2.2). Never use JS numbers for prices/sizes/USD.
import { Decimal } from "decimal.js";

export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof D>;

/** Parse a decimal string (or a JSON number from an endpoint that returns numbers, e.g. /v2/fee-tiers). */
export function dec(x: string | number): Dec {
  if (typeof x === "number") {
    if (!Number.isFinite(x)) throw new Error(`non-finite number: ${x}`);
    return new D(String(x));
  }
  if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(x.trim())) throw new Error(`not a decimal string: "${x}"`);
  return new D(x.trim());
}

/** Round down to a multiple of `step` (e.g. LOT_SIZE.stepSize). */
export function floorToStep(value: Dec, step: Dec): Dec {
  if (step.lte(0)) throw new Error("step must be > 0");
  return value.div(step).floor().mul(step);
}

/** Round to the nearest multiple of `tick` (e.g. PRICE_FILTER.tickSize), with explicit direction. */
export function roundToTick(value: Dec, tick: Dec, mode: "down" | "up" | "nearest" = "nearest"): Dec {
  if (tick.lte(0)) throw new Error("tick must be > 0");
  const q = value.div(tick);
  const r = mode === "down" ? q.floor() : mode === "up" ? q.ceil() : q.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
  return r.mul(tick);
}
