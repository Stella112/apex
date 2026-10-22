import { describe, expect, it } from "vitest";
import { paperCheckStops, paperClose, paperIsoAdd, paperOpen, emptyPaper, paperFree } from "../src/paper.js";
import { fakeApex, fakeLiveApex } from "./fake-strike.js";

describe("paper ledger", () => {
  it("open → stop trigger → close realizes PnL and releases margin", () => {
    let s = emptyPaper();
    s = paperOpen(s, "NVDA-USD", "buy", "2", "200", 5, "0.0005", "t0");
    expect(s.positions[0]!.iso_balance).toBe("80");
    expect(s.walletBalance).toBe("999.8"); // fee 0.2
    expect(paperFree(s).toString()).toBe("919.8");
    s = { ...s, orders: [{ id: "o1", symbol: "NVDA-USD", side: "sell", type: "stop", size: "2", stopPrice: "190", reduceOnly: true, status: "resting", createdAt: "t0" }] };
    s = paperCheckStops(s, { "NVDA-USD": "195" }, "0.0005", "t1");
    expect(s.orders[0]!.status).toBe("resting");
    s = paperCheckStops(s, { "NVDA-USD": "189" }, "0.0005", "t2");
    expect(s.orders[0]!.status).toBe("triggered");
    expect(s.positions.length).toBe(0);
    // realized (189−200)×2 = −22, fee 0.189
    expect(s.walletBalance).toBe("977.611");
  });
  it("partial close releases isolated margin pro rata; isoMargin add needs free balance", () => {
    let s = paperOpen(emptyPaper(), "NVDA-USD", "buy", "2", "200", 5, "0", "t0");
    s = paperClose(s, "NVDA-USD", "sell", "1", "210", "0", "t1", "test");
    expect(s.positions[0]!.size).toBe("1");
    expect(s.positions[0]!.iso_balance).toBe("40");
    expect(s.walletBalance).toBe("1010");
    s = paperIsoAdd(s, "NVDA-USD", "10");
    expect(s.positions[0]!.iso_balance).toBe("50");
    expect(() => paperIsoAdd(s, "NVDA-USD", "100000")).toThrow(/insufficient/);
    expect(() => paperClose(s, "NVDA-USD", "buy", "1", "210", "0", "t", "x")).toThrow(/wrong side/);
  });
});

describe("LIVE path (mocked Strike, no network)", () => {
  it("protective stop: one signed POST /v2/order, reduce-only, then Strike's reconciled status", async () => {
    const { apex, writes } = fakeLiveApex();
    expect(apex.mode).toBe("live");
    const r = await apex.proposeProtection("NVDA-USD", "protective_stop", "own");
    expect(r.proposals.length).toBe(1);
    const p = r.proposals[0]!;
    expect(p.mode).toBe("live");
    expect(p.verdict.warnings.map((w) => w.id)).toContain("R12");
    const ex = await apex.executeProposal(p.id, true);
    expect(writes.length).toBe(1);
    const w = writes[0]!;
    expect(w.method).toBe("POST");
    expect(w.path).toBe("/v2/order");
    expect(w.body).toMatchObject({ symbol: "NVDA-USD", side: "sell", type: "stop", size: "2", reduce_only: true });
    expect((w.body as { client_order_id: string }).client_order_id).toMatch(/^apex-/);
    expect(w.headers["X-API-Wallet-Signature"]).toMatch(/^[0-9a-f]{128}$/);
    expect(w.headers["X-Builder-Fee-Bps"]).toBeUndefined();
    expect(ex.label).toBe("LIVE");
    expect(ex.status).toBe("untriggered (Strike)");
    expect(apex.verifyLog().ok).toBe(true);
  });

  it("LIVE execution without confirmation sends nothing", async () => {
    const { apex, writes } = fakeLiveApex();
    const p = (await apex.proposeProtection("NVDA-USD", "protective_stop", "own")).proposals[0]!;
    const ex = await apex.executeProposal(p.id, false);
    expect(ex.status).toBe("not_confirmed");
    expect(writes.length).toBe(0);
  });

  it("LIVE opens are refused (out of scope) and send nothing", async () => {
    const { apex, writes } = fakeLiveApex();
    const { proposal } = await apex.proposeTrade({ symbol: "NVDA-USD", side: "buy", size: "0.1", leverage: 2, orderType: "market" }, "own");
    const ex = await apex.executeProposal(proposal.id, true);
    expect(["error", "blocked_by_referee"]).toContain(ex.status);
    expect(writes.length).toBe(0);
  });

  it("a proposal cannot be executed twice", async () => {
    const { apex } = fakeLiveApex();
    const p = (await apex.proposeProtection("NVDA-USD", "protective_stop", "own")).proposals[0]!;
    await apex.executeProposal(p.id, true);
    await expect(apex.executeProposal(p.id, true)).rejects.toThrow(/executed/);
  });

  it("PAPER mode is the default without APEX_MODE=live", () => {
    expect(fakeApex().apex.mode).toBe("paper");
  });
});
