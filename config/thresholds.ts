// Fail-closed freshness limits (CLAUDE.md §6.2) and Weekend Shield thresholds (§6.6).
export const FRESHNESS_MS = {
  mark: 15_000,
  depth: 10_000,
  account: 15_000,
} as const;

/** Proposal lifetime (CLAUDE.md §6.4). */
export const PROPOSAL_TTL_MS = 120_000;

/** Default slippage for reduce-only market closes (CLAUDE.md §6.4). */
export const DEFAULT_CLOSE_SLIPPAGE = "0.01";

/** Gap-risk bands on p_gap (CLAUDE.md §6.6): LOW < 5%, MEDIUM 5–20%, HIGH > 20%. */
export const GAP_BANDS = { lowBelow: "0.05", highAbove: "0.20" } as const;

/** THIN_BOOK when depth within ±1% of mark is below this USD amount (CLAUDE.md §6.6 example). */
export const THIN_BOOK_USD = "10000";
