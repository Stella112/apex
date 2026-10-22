#!/usr/bin/env node
// Apex MCP server over stdio (Claude Desktop / Claude Code). stdout carries the protocol:
// diagnostics go to stderr only, and keys are never printed.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { apexFromEnv } from "./env.js";
import { createServer } from "./server.js";

const apex = apexFromEnv();
const server = createServer(apex);
await server.connect(new StdioServerTransport());
console.error(`apex-mcp ready (env ${process.env.STRIKE_ENV ?? "mainnet"}, mode ${apex.mode}, keys ${apex.hasKeys ? "present" : "absent"})`);
