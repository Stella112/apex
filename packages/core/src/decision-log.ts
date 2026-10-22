// Append-only, hash-chained, signed decision log (CLAUDE.md §6.9).
// hash = sha256(prevHash + canonicalJSON(entry without hash/sig)); sig = ed25519(LOG_SIGNING_KEY, hash).
import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export const GENESIS_HASH = "0".repeat(64);

export interface LogEntry {
  seq: number;
  ts: string;
  type: string;
  mode: "paper" | "live" | "scenario";
  payload: unknown;
  prevHash: string;
  hash: string;
  sig: string;
}

/** Deterministic JSON: object keys sorted recursively, undefined dropped, non-finite numbers rejected. */
export function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJSON: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJSON(v))).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(",")}}`;
  }
  throw new Error(`canonicalJSON: unsupported type ${typeof value}`);
}

export function entryHash(e: Omit<LogEntry, "hash" | "sig">): string {
  const body = canonicalJSON({ seq: e.seq, ts: e.ts, type: e.type, mode: e.mode, payload: e.payload, prevHash: e.prevHash });
  return bytesToHex(sha256(utf8ToBytes(e.prevHash + body)));
}

export interface LogSigner {
  publicKeyHex: string;
  sign(hashHex: string): string;
}

export function logSignerFromSeed(seedHex: string): LogSigner {
  const seed = hexToBytes(seedHex.trim().toLowerCase());
  if (seed.length !== 32) throw new Error("LOG_SIGNING_KEY must be 32 bytes hex");
  return {
    publicKeyHex: bytesToHex(ed.getPublicKey(seed)),
    sign: (h) => bytesToHex(ed.sign(hexToBytes(h), seed)),
  };
}

/**
 * LOG_SIGNING_KEY from env, else keys/log_signing.key (generated on first run). Separate from the
 * trading key (CLAUDE.md §6.9). `keys/` is gitignored.
 */
export function loadOrCreateLogSigner(envSeed: string | undefined, keyFile: string): LogSigner {
  if (envSeed && envSeed.trim()) return logSignerFromSeed(envSeed);
  if (existsSync(keyFile)) return logSignerFromSeed(readFileSync(keyFile, "utf8"));
  mkdirSync(dirname(keyFile), { recursive: true });
  const seed = bytesToHex(randomBytes(32));
  writeFileSync(keyFile, seed, { mode: 0o600 });
  return logSignerFromSeed(seed);
}

export class DecisionLog {
  private lastSeq = 0;
  private lastHash = GENESIS_HASH;

  constructor(private readonly file: string, private readonly signer: LogSigner, private readonly now: () => number = Date.now) {
    mkdirSync(dirname(file), { recursive: true });
    const entries = readEntries(file);
    const last = entries[entries.length - 1];
    if (last) {
      this.lastSeq = last.seq;
      this.lastHash = last.hash;
    }
  }

  get publicKeyHex(): string {
    return this.signer.publicKeyHex;
  }

  append(type: string, mode: LogEntry["mode"], payload: unknown): LogEntry {
    const base = { seq: this.lastSeq + 1, ts: new Date(this.now()).toISOString(), type, mode, payload, prevHash: this.lastHash };
    // Round-trip through JSON so the stored payload is exactly what gets hashed.
    const normalized = { ...base, payload: JSON.parse(JSON.stringify(payload ?? null)) as unknown };
    const hash = entryHash(normalized);
    const entry: LogEntry = { ...normalized, hash, sig: this.signer.sign(hash) };
    appendFileSync(this.file, JSON.stringify(entry) + "\n");
    this.lastSeq = entry.seq;
    this.lastHash = hash;
    return entry;
  }

  entries(): LogEntry[] {
    return readEntries(this.file);
  }
}

export function readEntries(file: string): LogEntry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as LogEntry);
}

export interface VerifyResult {
  ok: boolean;
  entries: number;
  firstBadSeq?: number;
  error?: string;
}

/** Recompute the chain and check every signature (CLAUDE.md §6.9). */
export function verifyLog(file: string, publicKeyHex: string): VerifyResult {
  let lines: string[];
  try {
    lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()) : [];
  } catch (e) {
    return { ok: false, entries: 0, error: String(e) };
  }
  let prev = GENESIS_HASH;
  const pub = hexToBytes(publicKeyHex);
  for (let i = 0; i < lines.length; i++) {
    let e: LogEntry;
    try {
      e = JSON.parse(lines[i]!) as LogEntry;
    } catch {
      return { ok: false, entries: lines.length, firstBadSeq: i + 1, error: `line ${i + 1}: invalid JSON` };
    }
    if (e.seq !== i + 1) return { ok: false, entries: lines.length, firstBadSeq: i + 1, error: `line ${i + 1}: seq ${e.seq}, expected ${i + 1}` };
    if (e.prevHash !== prev) return { ok: false, entries: lines.length, firstBadSeq: e.seq, error: `seq ${e.seq}: prevHash does not match previous entry` };
    const h = entryHash(e);
    if (h !== e.hash) return { ok: false, entries: lines.length, firstBadSeq: e.seq, error: `seq ${e.seq}: hash mismatch (entry altered)` };
    let sigOk = false;
    try {
      sigOk = ed.verify(hexToBytes(e.sig), hexToBytes(e.hash), pub);
    } catch {
      sigOk = false;
    }
    if (!sigOk) return { ok: false, entries: lines.length, firstBadSeq: e.seq, error: `seq ${e.seq}: bad signature` };
    prev = e.hash;
  }
  return { ok: true, entries: lines.length };
}
