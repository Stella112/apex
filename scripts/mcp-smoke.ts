// Spawns the built MCP server over stdio (as Claude Desktop does) and calls the Phase 5 gate tools live.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../packages/mcp/dist/index.js", import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: "inherit" });
const client = new Client({ name: "apex-smoke", version: "1.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);
for (const [name, args] of [
  ["list_markets", { class: "equity" }],
  ["simulate_trade", { symbol: "NVDA-USD", side: "buy", notionalUsd: "1000", leverage: 10, orderType: "market" }],
  ["weekend_risk_report", { source: "vault" }],
] as const) {
  const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  console.log(`\n== ${name}${r.isError ? " (ERROR)" : ""}\n${r.content[0]!.text}`);
}
await client.close();
