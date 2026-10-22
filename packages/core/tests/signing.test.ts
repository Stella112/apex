import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { EMPTY_BODY_HASH, bodyHash, parseApiWalletKey, signHeaders, signingMessage } from "../src/signing.js";

// RFC 8032 §7.1 TEST 1 — proves the library wiring (sha512Sync) produces standard Ed25519.
const RFC_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const RFC_PUB = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const RFC_SIG_EMPTY =
  "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

describe("signing", () => {
  it("matches RFC 8032 test vector 1", () => {
    const key = parseApiWalletKey(RFC_PUB, RFC_SEED);
    expect(bytesToHex(ed.sign(new Uint8Array(), key.seed))).toBe(RFC_SIG_EMPTY);
  });

  it("uses sha256('') for an absent body, never an empty string", () => {
    expect(bodyHash(undefined)).toBe(EMPTY_BODY_HASH);
    expect(bodyHash("")).toBe(EMPTY_BODY_HASH);
    expect(bodyHash('{"a":1}')).toBe("015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862");
  });

  it("builds METHOD:PATH?QUERY:TS:NONCE:BODY_HASH", () => {
    expect(signingMessage("get", "/v2/positions?symbol=BTC-USD", 1792697286, "0b7c6a8e-1d2f-4e3a-9b8c-7d6e5f4a3b2c", undefined)).toBe(
      "GET:/v2/positions?symbol=BTC-USD:1792697286:0b7c6a8e-1d2f-4e3a-9b8c-7d6e5f4a3b2c:" + EMPTY_BODY_HASH,
    );
  });

  it("produces a stable, verifiable signature for a fixed key, nonce and timestamp", () => {
    const key = parseApiWalletKey(RFC_PUB, RFC_SEED);
    const input = { method: "GET", pathWithQuery: "/v2/positions?symbol=BTC-USD", body: undefined, timestampSec: 1792697286, nonce: "0b7c6a8e-1d2f-4e3a-9b8c-7d6e5f4a3b2c" };
    const h = signHeaders(key, input);
    expect(h["X-API-Wallet-Public-Key"]).toBe(RFC_PUB);
    expect(h["X-API-Wallet-Timestamp"]).toBe("1792697286");
    expect(h["X-API-Wallet-Nonce"]).toBe(input.nonce);
    expect(h["X-API-Wallet-Signature"]).toMatch(/^[0-9a-f]{128}$/);
    const msg = signingMessage(input.method, input.pathWithQuery, input.timestampSec, input.nonce, input.body);
    expect(ed.verify(hexToBytes(h["X-API-Wallet-Signature"]!), utf8ToBytes(msg), hexToBytes(RFC_PUB))).toBe(true);
    // Deterministic Ed25519: same inputs → same signature (regression pin).
    expect(signHeaders(key, input)["X-API-Wallet-Signature"]).toBe(h["X-API-Wallet-Signature"]);
    expect(h["X-API-Wallet-Signature"]).toMatchSnapshot();
  });

  it("accepts a 64-byte secret and uses the first 32 bytes", () => {
    const key = parseApiWalletKey(RFC_PUB, RFC_SEED + RFC_PUB);
    expect(bytesToHex(key.seed)).toBe(RFC_SEED);
  });

  it("rejects a public key that does not match the private key", () => {
    expect(() => parseApiWalletKey("00".repeat(32), RFC_SEED)).toThrow(/does not match/);
  });

  it("never serializes the private seed", () => {
    const key = parseApiWalletKey(RFC_PUB, RFC_SEED);
    expect(JSON.stringify(key)).not.toContain(RFC_SEED);
    expect(JSON.stringify(key)).not.toContain("seed");
  });

  it("rejects nonces outside 16–128 chars", () => {
    const key = parseApiWalletKey(RFC_PUB, RFC_SEED);
    expect(() => signHeaders(key, { method: "GET", pathWithQuery: "/v2/account", body: undefined, timestampSec: 1, nonce: "short" })).toThrow();
  });
});
