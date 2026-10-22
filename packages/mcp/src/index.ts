#!/usr/bin/env node
// Apex MCP server over stdio (Claude Desktop / Claude Code). stdout carries the protocol:
// diagnostics go to stderr only, and keys are never printed.
import { Apex, type StrikeEnv } from "@apex/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";

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

const server = createServer(apex);
await server.connect(new StdioServerTransport());
console.error(`apex-mcp ready (env ${process.env.STRIKE_ENV ?? "mainnet"}, mode ${apex.mode}, keys ${apex.hasKeys ? "present" : "absent"})`);
