// Calls the Streamable HTTP MCP endpoint (start it with: node packages/mcp/dist/http.js).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const client = new Client({ name: "apex-http-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8788/mcp")));
const { tools } = await client.listTools();
console.log(`tools over HTTP: ${tools.length}`);
const r = (await client.callTool({ name: "get_fair_value", arguments: { symbol: "NVDA-USD" } })) as { content: Array<{ text: string }> };
console.log(r.content[0]!.text);
const p = (await client.callTool({ name: "get_policy", arguments: {} })) as { content: Array<{ text: string }> };
console.log(p.content[0]!.text);
await client.close();
