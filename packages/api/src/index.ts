// Local / Docker server: binds 127.0.0.1 by default (no dashboard auth is in scope). With APEX_PUBLIC_DEMO=1 it
// binds 0.0.0.0 on $PORT (Render/Docker) and runs the PAPER vault on a timer. On Vercel use api/[...path].js instead.
import { createServer } from "node:http";
import { PUBLIC, apex, handler, seedOnce, vaultFresh } from "./app.js";

const PORT = Number(process.env.PORT ?? process.env.APEX_API_PORT ?? 8787);

createServer((req, res) => void handler(req, res)).listen(PORT, PUBLIC ? "0.0.0.0" : "127.0.0.1", () => {
  // Warm the registry and 1h mark history so the first Circuit/Shield request is fast.
  apex.weekendRiskReport("paper", { log: false }).catch((e: unknown) => console.error("warmup failed:", e instanceof Error ? e.message : e));
  console.error(`apex api + dashboard on port ${PORT} (${PUBLIC ? "PUBLIC read-only demo" : "local"}, mode ${apex.mode}, keys ${apex.hasKeys ? "present" : "absent"})`);
  if (PUBLIC) {
    void seedOnce();
    setTimeout(() => void vaultFresh(), 30_000);
    setInterval(() => void vaultFresh(), 5 * 60_000).unref();
  }
});
