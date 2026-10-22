// Thin client for the local Apex API. Types come from @apex/core (type-only, erased at build).
import type { CircuitReport, MarketGapStats, MarketRecord, PositionGapRisk, Proposal, ExecutionResult, LogEntry, Policy, Verdict } from "@apex/core";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}
const post = <T,>(path: string, b: unknown) => j<T>(path, { method: "POST", body: JSON.stringify(b) });

export type Source = "own" | "paper" | "vault";
export interface Status { mode: "paper" | "live"; apexMode: string; hasKeys: boolean; env: string; defaultSource: Source; vaultId: string | null }

export const api = {
  status: () => j<Status>("/api/status"),
  markets: () => j<{ markets: MarketRecord[]; label: string }>("/api/markets"),
  simulate: (b: Record<string, unknown>) => post<CircuitReport>("/api/simulate", b),
  positions: (s: Source) => j<{ label: string; positions: PositionGapRisk[]; asOf: string }>(`/api/positions?source=${s}`),
  weekend: (s: Source) => j<{ markets: MarketGapStats[]; positions: PositionGapRisk[]; positionsLabel: string; asOf: string; logSeq: number }>(`/api/weekend?source=${s}`),
  proposeProtection: (symbol: string, source: Source, kind?: string) => post<{ proposals: Proposal[]; note: string; position: PositionGapRisk }>("/api/propose/protection", { symbol, source, kind }),
  proposeTrade: (b: Record<string, unknown>) => post<{ proposal: Proposal; circuit: CircuitReport }>("/api/propose/trade", b),
  execute: (proposalId: string) => post<ExecutionResult>("/api/execute", { proposalId, confirm: true }),
  log: (limit = 100) => j<{ entries: LogEntry[] }>(`/api/log?limit=${limit}`),
  verify: () => j<{ ok: boolean; entries: number; firstBadSeq?: number; error?: string; publicKey: string }>("/api/log/verify"),
  policy: () => j<Policy>("/api/policy"),
  creditHealth: (b: Record<string, string>) => post<CreditHealth>("/api/credit/health", b),
  creditGrid: (b: Record<string, string>) => post<CreditGrid>("/api/credit/grid", b),
};

export type CreditHealth = Awaited<ReturnType<import("@apex/core").Apex["creditLineHealth"]>>;
export type CreditGrid = Awaited<ReturnType<import("@apex/core").Apex["creditStressGrid"]>>;

export type { CircuitReport, MarketGapStats, MarketRecord, PositionGapRisk, Proposal, ExecutionResult, LogEntry, Policy, Verdict };
