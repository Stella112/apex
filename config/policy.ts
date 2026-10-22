// Default risk policy (CLAUDE.md §6.3). Validated by the core PolicySchema before use.
import defaultPolicy from "./policy.default.json" with { type: "json" };

export const DEFAULT_POLICY_JSON: unknown = defaultPolicy;
