#!/usr/bin/env node
// Apex MCP over Streamable HTTP (CLAUDE.md §5 P1.9 — prepares remote/ChatGPT hosting).
// Stateless mode: a fresh McpServer + transport per request. Binds to 127.0.0.1 with DNS-rebinding
// protection; exposing it beyond localhost needs auth, which is out of scope (README roadmap).
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer } from "node:http";
import { apexFromEnv } from "./env.js";
import { createServer } from "./server.js";

const apex = apexFromEnv();
const PORT = Number(process.env.APEX_MCP_HTTP_PORT ?? 8788);
const HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];

const http = createHttpServer(async (req, res) => {
  if (!req.url?.startsWith("/mcp")) {
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "POST /mcp" }));
    return;
  }
  const server = createServer(apex);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: HOSTS,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(e) }));
  }
});
http.listen(PORT, "127.0.0.1", () => console.error(`apex-mcp (streamable HTTP) on http://127.0.0.1:${PORT}/mcp (mode ${apex.mode})`));
