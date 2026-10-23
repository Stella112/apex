// Vercel serverless entry: the whole Apex API as one function (public read-only demo).
// vercel.json rewrites every /api/<path> here as /api/apex?__p=<path>; the original URL is restored below
// (a [...path] file only catches one segment outside Next.js).
// Vercel's filesystem is read-only except /tmp, and instances are ephemeral: state is rebuilt per instance
// (the PAPER account is seeded on first use). The public flag is forced on so this function can never trade.
export default async function apexApi(req, res) {
  process.env.APEX_PUBLIC_DEMO = "1";
  process.env.APEX_STATE_DIR ??= "/tmp/apex/logs";
  process.env.STRIKE_ENV ??= "mainnet";
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  const p = u.searchParams.get("__p");
  if (p !== null) {
    u.searchParams.delete("__p");
    req.url = `/api/${p}${u.search}`;
  }
  const { handler } = await import("../packages/api/dist/app.js");
  return handler(req, res);
}
