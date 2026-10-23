// Tiny HTTP API for the dashboard (CLAUDE.md §8: node:http, reuses core). Binds to 127.0.0.1 by default —
// no dashboard auth is in scope. Also serves the built web app.
// APEX_PUBLIC_DEMO=1 = public read-only demo: binds 0.0.0.0 (PORT), refuses to start with API keys or
// APEX_MODE=live, blocks every write route (403), rate-limits per IP, seeds the PAPER account once on
// live prices and runs the PAPER Mandate Vault on a timer.
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

const PUBLIC = process.env.APEX_PUBLIC_DEMO === "1";
if (PUBLIC && (apex.hasKeys || apex.apexMode === "live")) {
  // A public site must never hold trading keys or LIVE mode.
  throw new Error("APEX_PUBLIC_DEMO=1 refuses to start with STRIKE_API_* keys or APEX_MODE=live");
}
const WEB = join(ROOT, "packages", "web", "dist");
const PORT = Number(process.env.PORT ?? process.env.APEX_API_PORT ?? 8787);
const WRITE_ROUTES = /^\/api\/(execute|policy|propose\/.+|vault\/tick)$/;
const hits = new Map<string, number[]>();
/** 120 requests / minute / client IP (public demo only; protects the Strike API budget). */
function limited(req: IncomingMessage): boolean {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0]!.trim();
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 120;
}
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
  ["GET", /^\/api\/status$/, () => ({ readOnly: PUBLIC, mode: apex.mode, apexMode: apex.apexMode, hasKeys: apex.hasKeys, env: apex.client.env, defaultSource: apex.defaultSource(), vaultId: apex.vaultId ?? null })],
  ["GET", /^\/api\/markets$/, async () => ({ mode: apex.mode, label: "LIVE", markets: await apex.listMarkets() })],
  ["GET", /^\/api\/market\/([A-Za-z0-9-]+)$/, (_u, _b, m) => apex.getMarket(m[1]!)],
  ["POST", /^\/api\/simulate$/, (u, b) => apex.simulateTrade(b as never, (b.source as PositionSource) ?? src(u), { log: b.log !== false && !PUBLIC })],
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
  ["POST", /^\/api\/credit\/health$/, (_u, b) => apex.creditLineHealth(b as never, { log: !PUBLIC })],
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
  if (PUBLIC && limited(req)) return send(res, 429, { error: "rate limit: 120 requests per minute" });
  if (PUBLIC && req.method === "POST" && WRITE_ROUTES.test(u.pathname)) {
    return send(res, 403, { error: "read-only public demo: executing, proposing, policy changes and vault ticks are disabled. Run Apex locally for the full propose → confirm → execute flow." });
  }
  const route = routes.find(([m, re]) => m === req.method && re.test(u.pathname));
  if (!route) return send(res, 404, { error: "not found" });
  try {
    const b = req.method === "POST" ? ((await body(req)) as Record<string, unknown>) : {};
    send(res, 200, await route[2](u, b, u.pathname.match(route[1])!));
  } catch (e) {
    send(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}).listen(PORT, PUBLIC ? "0.0.0.0" : "127.0.0.1", () => {
  // Warm the registry and 1h mark history so the first Circuit/Shield request is fast.
  apex.weekendRiskReport("paper", { log: false }).catch((e: unknown) => console.error("warmup failed:", e instanceof Error ? e.message : e));
  console.error(`apex api + dashboard on port ${PORT} (${PUBLIC ? "PUBLIC read-only demo" : "local"}, mode ${apex.mode}, keys ${apex.hasKeys ? "present" : "absent"})`);
  if (PUBLIC) void seedAndSchedule();
});

/** Public demo: seed the PAPER account once (real propose → referee → execute on live prices), then tick the PAPER vault. */
async function seedAndSchedule() {
  try {
    const acct = (await apex.accountSummary("paper")) as { positions: number };
    if (acct.positions === 0) {
      for (const symbol of ["NVDA-USD", "SKHYNIX-USD"]) {
        const { proposal } = await apex.proposeTrade({ symbol, side: "buy", notionalUsd: "450", leverage: 3, orderType: "market" }, "paper");
        if (proposal.verdict.decision === "APPROVE") await apex.executeProposal(proposal.id, true);
      }
      const prot = await apex.proposeProtection("SKHYNIX-USD", "protective_stop", "paper");
      for (const p of prot.proposals) if (p.verdict.decision === "APPROVE") await apex.executeProposal(p.id, true);
      console.error("public demo: PAPER account seeded on live prices");
    }
  } catch (e) {
    console.error("seed failed:", e instanceof Error ? e.message : e);
  }
  const tick = () => apex.vaultTick().catch((e: unknown) => console.error("vault tick failed:", e instanceof Error ? e.message : e));
  setTimeout(tick, 30_000);
  setInterval(tick, 30 * 60_000).unref();
}
