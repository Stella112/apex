// Tiny local HTTP API for the dashboard (CLAUDE.md §8: node:http, reuses core). Binds to 127.0.0.1
// only — no dashboard auth beyond localhost is in scope. Also serves the built web app.
import { Apex, type PositionSource, type StrikeEnv } from "@apex/core";
import { config } from "dotenv";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: `${ROOT}.env`, quiet: true });

const apex = new Apex({
  env: (process.env.STRIKE_ENV ?? "mainnet") as StrikeEnv,
  publicKey: process.env.STRIKE_API_PUBLIC_KEY?.trim() || undefined,
  privateKey: process.env.STRIKE_API_PRIVATE_KEY?.trim() || undefined,
  apexMode: process.env.APEX_MODE === "live" ? "live" : "paper",
  stateDir: process.env.APEX_STATE_DIR || `${ROOT}logs`,
  logSigningKey: process.env.LOG_SIGNING_KEY?.trim() || undefined,
  vaultId: process.env.VAULT_ID?.trim() || undefined,
});

const WEB = join(ROOT, "packages", "web", "dist");
const PORT = Number(process.env.APEX_API_PORT ?? 8787);
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const src = (u: URL): PositionSource => (u.searchParams.get("source") as PositionSource | null) ?? apex.defaultSource();

type Handler = (u: URL, b: Record<string, unknown>, m: RegExpMatchArray) => Promise<unknown> | unknown;
const routes: Array<[string, RegExp, Handler]> = [
  ["GET", /^\/api\/status$/, () => ({ mode: apex.mode, apexMode: apex.apexMode, hasKeys: apex.hasKeys, env: apex.client.env, defaultSource: apex.defaultSource(), vaultId: apex.vaultId ?? null })],
  ["GET", /^\/api\/markets$/, async () => ({ mode: apex.mode, label: "LIVE", markets: await apex.listMarkets() })],
  ["GET", /^\/api\/market\/([A-Za-z0-9-]+)$/, (_u, _b, m) => apex.getMarket(m[1]!)],
  ["POST", /^\/api\/simulate$/, (u, b) => apex.simulateTrade(b as never, (b.source as PositionSource) ?? src(u), { log: b.log !== false })],
  ["GET", /^\/api\/positions$/, (u) => apex.positionsWithRisk(src(u))],
  ["GET", /^\/api\/account$/, (u) => apex.accountSummary(src(u))],
  ["GET", /^\/api\/weekend$/, (u) => apex.weekendRiskReport(src(u), { log: false })],
  ["GET", /^\/api\/gapstats$/, () => apex.marketGapStatsAll()],
  ["GET", /^\/api\/history\/([A-Za-z0-9-]+)$/, (_u, _b, m) => apex.markHistory(m[1]!)],
  ["GET", /^\/api\/liq-check$/, async () => {
    // Apex's liquidation formula vs Strike's own liquidation_price (own account with keys, else the public SLP vault).
    const source = apex.hasKeys ? "own" : "vault";
    const checks = await apex.validateLiquidations(source);
    const priced = checks.filter((c) => c.diffPct !== null);
    return {
      label: "LIVE", source: source === "own" ? "your Strike account" : "SLP vault (public, read-only)",
      total: checks.length, matched: checks.filter((c) => c.match).length,
      maxDiffPct: priced.reduce((m, c) => Math.max(m, Number(c.diffPct)), 0).toFixed(4), checks, asOf: new Date().toISOString(),
    };
  }],
  ["POST", /^\/api\/propose\/protection$/, (u, b) => apex.proposeProtection(String(b.symbol), b.kind as never, (b.source as PositionSource) ?? src(u))],
  ["POST", /^\/api\/propose\/trade$/, (u, b) => apex.proposeTrade(b as never, (b.source as PositionSource) ?? src(u))],
  ["POST", /^\/api\/execute$/, (_u, b) => apex.executeProposal(String(b.proposalId), b.confirm === true)],
  ["GET", /^\/api\/log$/, (u) => ({ entries: apex.decisionLog(Number(u.searchParams.get("limit") ?? 100)).reverse() })],
  ["GET", /^\/api\/log\/verify$/, () => apex.verifyLog()],
  ["GET", /^\/api\/policy$/, () => apex.getPolicy()],
  ["GET", /^\/api\/fairvalue\/([A-Za-z0-9-]+)$/, (_u, _b, m) => apex.fairValue(m[1]!)],
  ["GET", /^\/api\/vault$/, () => apex.vaultStatus()],
  ["GET", /^\/api\/vault\/decisions$/, () => ({ decisions: apex.vaultDecisions(100) })],
  ["POST", /^\/api\/vault\/tick$/, () => apex.vaultTick()],
  ["POST", /^\/api\/credit\/health$/, (_u, b) => apex.creditLineHealth(b as never)],
  ["POST", /^\/api\/credit\/grid$/, (_u, b) => apex.creditStressGrid(b as never)],
  ["POST", /^\/api\/policy$/, (_u, b) => apex.setPolicy(b)],
];

function serveStatic(u: URL, res: ServerResponse) {
  if (!existsSync(WEB)) return send(res, 404, { error: "dashboard not built: run pnpm --filter @apex/web build" });
  const rel = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "");
  let file = join(WEB, rel);
  if (!file.startsWith(WEB) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}

createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!u.pathname.startsWith("/api/")) return serveStatic(u, res);
  const route = routes.find(([m, re]) => m === req.method && re.test(u.pathname));
  if (!route) return send(res, 404, { error: "not found" });
  try {
    const b = req.method === "POST" ? ((await body(req)) as Record<string, unknown>) : {};
    send(res, 200, await route[2](u, b, u.pathname.match(route[1])!));
  } catch (e) {
    send(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}).listen(PORT, "127.0.0.1", () => {
  // Warm the registry and 1h mark history so the first Circuit/Shield request is fast.
  apex.weekendRiskReport("paper", { log: false }).catch((e: unknown) => console.error("warmup failed:", e instanceof Error ? e.message : e));
  console.error(`apex api + dashboard on http://127.0.0.1:${PORT} (mode ${apex.mode}, keys ${apex.hasKeys ? "present" : "absent"})`);
});
