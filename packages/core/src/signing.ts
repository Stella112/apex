// API wallet request signing. Source: ref/strike-finance-skills/skills/strike-auth/SKILL.md
// ("API Wallet Request Signing"), mirrored in CLAUDE.md §4.2.
import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

/** sha256("") — the BODY_HASH for requests without a body (never an empty string). */
export const EMPTY_BODY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface ApiWalletKey {
  /** 64 lowercase hex chars, exactly as registered. */
  publicKeyHex: string;
  /** 32-byte Ed25519 seed. Never logged. */
  readonly seed: Uint8Array;
}

/** Parse keys from env. Accepts a 32-byte seed or 64-byte secret (first 32 bytes used), hex-encoded. */
export function parseApiWalletKey(publicKeyHex: string, privateKeyHex: string): ApiWalletKey {
  const priv = privateKeyHex.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]+$/.test(priv) || (priv.length !== 64 && priv.length !== 128)) {
    throw new Error("STRIKE_API_PRIVATE_KEY must be 64 or 128 hex chars");
  }
  const seed = hexToBytes(priv.toLowerCase()).slice(0, 32);
  const pub = publicKeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pub)) throw new Error("STRIKE_API_PUBLIC_KEY must be 64 hex chars");
  const derived = bytesToHex(ed.getPublicKey(seed));
  if (derived !== pub) throw new Error("STRIKE_API_PUBLIC_KEY does not match the private key");
  const key = { publicKeyHex: pub, seed };
  // Keep the seed out of JSON/inspection output.
  Object.defineProperty(key, "seed", { enumerable: false, value: seed, writable: false });
  return key;
}

export function bodyHash(body: string | undefined): string {
  return body === undefined || body === "" ? EMPTY_BODY_HASH : bytesToHex(sha256(utf8ToBytes(body)));
}

/** `{METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH}`; PATH includes `?query` exactly as sent. */
export function signingMessage(method: string, pathWithQuery: string, timestampSec: number, nonce: string, body: string | undefined): string {
  return `${method.toUpperCase()}:${pathWithQuery}:${timestampSec}:${nonce}:${bodyHash(body)}`;
}

export interface SignInput {
  method: string;
  pathWithQuery: string;
  body: string | undefined;
  timestampSec: number;
  nonce: string;
}

export function signHeaders(key: ApiWalletKey, input: SignInput): Record<string, string> {
  if (input.nonce.length < 16 || input.nonce.length > 128) throw new Error("nonce must be 16–128 chars");
  if (!Number.isInteger(input.timestampSec)) throw new Error("timestamp must be integer seconds");
  const msg = signingMessage(input.method, input.pathWithQuery, input.timestampSec, input.nonce, input.body);
  const sig = ed.sign(utf8ToBytes(msg), key.seed);
  return {
    "X-API-Wallet-Public-Key": key.publicKeyHex,
    "X-API-Wallet-Signature": bytesToHex(sig),
    "X-API-Wallet-Timestamp": String(input.timestampSec),
    "X-API-Wallet-Nonce": input.nonce,
  };
}
