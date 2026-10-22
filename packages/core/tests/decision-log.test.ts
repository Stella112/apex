import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DecisionLog, GENESIS_HASH, canonicalJSON, entryHash, loadOrCreateLogSigner, logSignerFromSeed, verifyLog } from "../src/decision-log.js";

const SEED = "11".repeat(32);
const tmp = () => mkdtempSync(join(tmpdir(), "apex-log-"));

function seeded() {
  const dir = tmp();
  const file = join(dir, "decisions.jsonl");
  let t = Date.parse("2026-10-22T20:00:00Z");
  const log = new DecisionLog(file, logSignerFromSeed(SEED), () => (t += 1000));
  log.append("proposal", "paper", { id: "p1", size: "2.35", symbol: "NVDA-USD" });
  log.append("verdict", "paper", { decision: "BLOCK", violations: ["R1", "R2"] });
  log.append("execution", "paper", { fill: "212.01" });
  return { file, log };
}

describe("canonicalJSON", () => {
  it("sorts keys recursively and drops undefined", () => {
    expect(canonicalJSON({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
  });
  it("rejects non-finite numbers", () => {
    expect(() => canonicalJSON({ x: Number.NaN })).toThrow();
  });
});

describe("decision log", () => {
  it("chains entries from the genesis hash and verifies", () => {
    const { file, log } = seeded();
    const e = log.entries();
    expect(e.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(e[0]!.prevHash).toBe(GENESIS_HASH);
    expect(e[1]!.prevHash).toBe(e[0]!.hash);
    expect(verifyLog(file, log.publicKeyHex)).toEqual({ ok: true, entries: 3 });
  });

  it("resumes the chain after reopening the file", () => {
    const { file } = seeded();
    const log2 = new DecisionLog(file, logSignerFromSeed(SEED));
    const e = log2.append("note", "paper", { x: 1 });
    expect(e.seq).toBe(4);
    expect(verifyLog(file, log2.publicKeyHex).ok).toBe(true);
  });

  it("TAMPER: editing one payload value fails verification at that entry", () => {
    const { file, log } = seeded();
    const lines = readFileSync(file, "utf8").trim().split("\n");
    lines[1] = lines[1]!.replace('"BLOCK"', '"APPROVE"');
    writeFileSync(file, lines.join("\n") + "\n");
    const r = verifyLog(file, log.publicKeyHex);
    expect(r.ok).toBe(false);
    expect(r.firstBadSeq).toBe(2);
    expect(r.error).toMatch(/hash mismatch/);
  });

  it("TAMPER: recomputing the hash without the key fails on the signature", () => {
    const { file, log } = seeded();
    const lines = readFileSync(file, "utf8").trim().split("\n");
    const e = JSON.parse(lines[0]!);
    e.payload.size = "23.5";
    // Attacker recomputes a valid hash but cannot sign it.
    e.hash = entryHash(e);
    lines[0] = JSON.stringify(e);
    writeFileSync(file, lines.join("\n") + "\n");
    const r = verifyLog(file, log.publicKeyHex);
    expect(r.ok).toBe(false);
    expect(r.firstBadSeq).toBe(1);
  });

  it("TAMPER: deleting a line breaks the chain", () => {
    const { file, log } = seeded();
    const lines = readFileSync(file, "utf8").trim().split("\n");
    writeFileSync(file, [lines[0], lines[2]].join("\n") + "\n");
    expect(verifyLog(file, log.publicKeyHex).ok).toBe(false);
  });

  it("fails verification with a different public key", () => {
    const { file } = seeded();
    expect(verifyLog(file, logSignerFromSeed("22".repeat(32)).publicKeyHex).ok).toBe(false);
  });

  it("generates a log key on first run when LOG_SIGNING_KEY is empty, then reuses it", () => {
    const keyFile = join(tmp(), "keys", "log_signing.key");
    const a = loadOrCreateLogSigner("", keyFile);
    const b = loadOrCreateLogSigner(undefined, keyFile);
    expect(a.publicKeyHex).toBe(b.publicKeyHex);
    expect(readFileSync(keyFile, "utf8")).toMatch(/^[0-9a-f]{64}$/);
  });
});
