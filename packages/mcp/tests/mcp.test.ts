import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeApex } from "../../core/tests/fake-strike.js";
import { createServer } from "../src/server.js";

const P0_TOOLS = [
  "list_markets", "get_market", "get_account_summary", "get_positions", "get_order_history", "simulate_trade",
  "stress_test_position", "weekend_risk_report", "propose_protection", "propose_trade", "execute_proposal",
  "cancel_order", "get_policy", "set_policy", "get_decision_log", "verify_log",
];

type CallResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

async function connect() {
  const f = fakeApex();
  const server = createServer(f.apex);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as CallResult;
    return { summary: r.content[0]!.text, json: r.content[1] ? JSON.parse(r.content[1].text) : null, isError: r.isError ?? false };
  };
  return { client, call, ...f };
}

describe("MCP server", () => {
  let ctx: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    ctx = await connect();
  });

  it("lists every P0 tool with an object input schema and the estimates disclaimer on analysis tools", async () => {
    const { tools } = await ctx.client.listTools();
    const names = tools.map((t) => t.name);
    for (const t of P0_TOOLS) expect(names).toContain(t);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.name).toMatch(/^[a-z_]+$/);
    }
    for (const t of tools.filter((x) => ["list_markets", "simulate_trade", "weekend_risk_report", "propose_trade"].includes(x.name))) {
      expect(t.description).toMatch(/not give financial advice/);
    }
  });

  it("list_markets returns the 33 live-fixture markets with labels", async () => {
    const r = await ctx.call("list_markets");
    expect(r.isError).toBe(false);
    expect(r.json.markets.length).toBe(33);
    expect(r.json.label).toBe("LIVE");
    expect(r.json.mode).toBe("paper");
    const eq = await ctx.call("list_markets", { class: "equity" });
    expect(eq.json.markets.every((m: { class: string }) => m.class === "equity")).toBe(true);
  });

  it("simulate_trade: $1,000 NVDA long at 10x is blocked with a compliant alternative", async () => {
    const r = await ctx.call("simulate_trade", { symbol: "NVDA-USD", side: "buy", notionalUsd: "1000", leverage: 10, orderType: "market" });
    expect(r.isError).toBe(false);
    expect(r.summary).toMatch(/Referee: BLOCK/);
    expect(r.summary).toMatch(/Compliant alternative/);
    expect(r.json.verdict.alternative.leverage).toBe(5);
  });

  it("rejects bad input instead of guessing", async () => {
    const r = await ctx.call("simulate_trade", { symbol: "NVDA-USD", side: "buy", notionalUsd: "1000", size: "1", leverage: 2, orderType: "market" });
    expect(r.isError).toBe(true);
    const u = await ctx.call("get_market", { symbol: "nvda-usd" });
    expect(u.isError).toBe(true);
    expect(u.summary).toMatch(/Unknown symbol/);
  });

  it("weekend_risk_report covers every non-crypto market with method and samples", async () => {
    const r = await ctx.call("weekend_risk_report", { source: "vault" });
    expect(r.isError).toBe(false);
    expect(r.json.markets.length).toBe(20);
    for (const m of r.json.markets) {
      expect(["EMPIRICAL", "MODELED"]).toContain(m.method);
      expect(typeof m.samples).toBe("number");
    }
    expect(r.json.positions.length).toBe(33);
  });

  it("PAPER end to end: propose → (no confirm refused) → confirm → protect → log verifies", async () => {
    const p = await ctx.call("propose_trade", { symbol: "NVDA-USD", side: "buy", size: "2.35", leverage: 5, orderType: "market", source: "paper" });
    expect(p.json.proposal.verdict.decision).toBe("APPROVE");
    const id = p.json.proposal.id;

    const refused = await ctx.call("execute_proposal", { proposalId: id, confirm: false });
    expect(refused.json.status).toBe("not_confirmed");

    const p2 = await ctx.call("propose_trade", { symbol: "NVDA-USD", side: "buy", size: "2.35", leverage: 5, orderType: "market", source: "paper" });
    const ex = await ctx.call("execute_proposal", { proposalId: p2.json.proposal.id, confirm: true });
    expect(ex.json.label).toBe("PAPER");
    expect(ex.json.status).toBe("filled (PAPER)");

    const pos = await ctx.call("get_positions", { source: "paper" });
    expect(pos.json.positions.length).toBe(1);
    expect(pos.json.label).toBe("PAPER");

    const prot = await ctx.call("propose_protection", { symbol: "NVDA-USD", kind: "protective_stop", source: "paper" });
    expect(prot.json.proposals.length).toBe(1);
    const stop = prot.json.proposals[0];
    expect(stop.action.reduceOnly).toBe(true);
    expect(stop.verdict.decision).toBe("APPROVE");
    const ex2 = await ctx.call("execute_proposal", { proposalId: stop.id, confirm: true });
    expect(ex2.json.status).toBe("resting (PAPER simulated stop)");

    const hist = await ctx.call("get_order_history", { source: "paper" });
    expect(hist.json.orders.length).toBe(1);

    const v = await ctx.call("verify_log");
    expect(v.json.ok).toBe(true);
    expect(v.json.entries).toBeGreaterThan(4);
  });

  it("set_policy validates and the referee uses the new policy", async () => {
    const bad = await ctx.call("set_policy", { maxPositionNotionalUsd: "abc" });
    expect(bad.isError).toBe(true);
    await ctx.call("set_policy", { maxLeverage: 2 });
    const r = await ctx.call("simulate_trade", { symbol: "NVDA-USD", side: "buy", size: "1", leverage: 3, orderType: "market" });
    expect(r.json.verdict.violations.map((v: { id: string }) => v.id)).toContain("R1");
  });

  it("expired proposals are refused", async () => {
    const p = await ctx.call("propose_trade", { symbol: "NVDA-USD", side: "buy", size: "1", leverage: 2, orderType: "market", source: "paper" });
    ctx.advance(121_000);
    const r = await ctx.call("execute_proposal", { proposalId: p.json.proposal.id, confirm: true });
    expect(r.json.status).toBe("expired");
  });

  it("never sends a write to Strike in PAPER mode", async () => {
    const p = await ctx.call("propose_trade", { symbol: "NVDA-USD", side: "buy", size: "1", leverage: 2, orderType: "market", source: "paper" });
    await ctx.call("execute_proposal", { proposalId: p.json.proposal.id, confirm: true });
    expect(ctx.calls.filter((c) => !c.startsWith("GET "))).toEqual([]);
  });
});
