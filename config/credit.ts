// Shared Borrow-and-Earn parameters not exposed by GET /v2/credit/settings.
// Source: https://docs.strikefinance.org/perpetuals/vaults/borrow-and-earn.md — "The shared parameters are"
// (current launch values). Per-asset M, X, d come live from /v2/credit/settings.
export const CREDIT_SHARED = {
  /** Y, vault reference loss */
  Y: "0.20",
  /** F, collateral floor */
  F: "0.50",
  /** r, recovery target parameter */
  r: "0.05",
} as const;
