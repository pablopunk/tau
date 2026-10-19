import { describe, expect, it } from "vitest";
import { base32 } from "./base32";
import {
  closeCodeFor,
  createHello,
  createProof,
  type HelloInfo,
  verifyHello,
  verifyProof,
} from "./handshake";
import { generateNodeKeys, keysMatch, nodeIdOf, signPayload, verifySignature } from "./keys";
import { DOMAIN_TAGS, parseSignedPayload, signedPayload } from "./signed-payload";

const info: HelloInfo = {
  name: "n",
  os: "darwin arm64",
  tauVersion: "0.2.0",
  protocolVersion: "p",
  linkProtocol: "l",
  capabilities: [],
};

describe("node identity", () => {
  it("derives a 52 character self-certifying id from the public key", () => {
    const keys = generateNodeKeys();
    expect(nodeIdOf(keys.publicKey)).toMatch(/^[a-z2-7]{52}$/);
    expect(nodeIdOf(keys.publicKey)).toBe(nodeIdOf(keys.publicKey));
    expect(nodeIdOf(generateNodeKeys().publicKey)).not.toBe(nodeIdOf(keys.publicKey));
    expect(keysMatch(keys)).toBe(true);
    expect(keysMatch({ ...keys, privateKey: generateNodeKeys().privateKey })).toBe(false);
  });

  it("base32 matches the RFC 4648 vectors (lower case, no padding)", () => {
    expect(base32(Buffer.from("foobar"))).toBe("mzxw6ytboi");
    expect(base32(Buffer.from("fo"))).toBe("mzxq");
    expect(base32(new Uint8Array(0))).toBe("");
  });

  it("signs a string verbatim and refuses another string, key or malformed input", () => {
    const keys = generateNodeKeys();
    const sig = signPayload(keys, "tau-proof-v1|a|b|c");
    expect(verifySignature(keys.publicKey, "tau-proof-v1|a|b|c", sig)).toBe(true);
    expect(verifySignature(keys.publicKey, "tau-proof-v1|a|b|d", sig)).toBe(false);
    expect(verifySignature(generateNodeKeys().publicKey, "tau-proof-v1|a|b|c", sig)).toBe(false);
    expect(verifySignature("short", "x", sig)).toBe(false);
    expect(verifySignature(keys.publicKey, "x", "short")).toBe(false);
  });

  it("builds payloads with a domain tag and refuses a field with the separator", () => {
    const payload = signedPayload(DOMAIN_TAGS.proof, "n", "a", "b");
    expect(payload).toBe("tau-proof-v1|n|a|b");
    expect(parseSignedPayload(payload, DOMAIN_TAGS.proof, 3)).toEqual(["n", "a", "b"]);
    expect(parseSignedPayload(payload, DOMAIN_TAGS.announce, 3)).toBeUndefined();
    expect(parseSignedPayload(payload, DOMAIN_TAGS.proof, 2)).toBeUndefined();
    expect(() => signedPayload(DOMAIN_TAGS.expel, "a|b")).toThrow(RangeError);
  });
});

describe("handshake", () => {
  const a = generateNodeKeys();
  const b = generateNodeKeys();
  const helloA = createHello(a, info);
  const helloB = createHello(b, info);
  const ids = { a: nodeIdOf(a.publicKey), b: nodeIdOf(b.publicKey) };

  it("creates a hello with a 16 byte nonce that is fresh every time", () => {
    expect(Buffer.from(helloA.nonce, "base64url")).toHaveLength(16);
    expect(createHello(a, info).nonce).not.toBe(helloA.nonce);
    expect(helloA.nodeId).toBe(ids.a);
  });

  it("accepts a good hello and proof in both directions", () => {
    expect(verifyHello(helloB, { ownNodeId: ids.a })).toEqual({ ok: true });
    expect(verifyProof(createProof(b, helloA), { ownHello: helloA, peerHello: helloB })).toEqual({
      ok: true,
    });
    expect(verifyProof(createProof(a, helloB), { ownHello: helloB, peerHello: helloA })).toEqual({
      ok: true,
    });
  });

  it("refuses a forged nodeId, a bad key and a bad nonce", () => {
    expect(verifyHello({ ...helloB, nodeId: ids.a }, { ownNodeId: "x" })).toEqual({
      ok: false,
      reason: "id-mismatch",
    });
    expect(verifyHello({ ...helloB, publicKey: "short" }, { ownNodeId: ids.a })).toEqual({
      ok: false,
      reason: "bad-key",
    });
    expect(verifyHello({ ...helloB, nonce: "AAAA" }, { ownNodeId: ids.a })).toEqual({
      ok: false,
      reason: "bad-nonce",
    });
  });

  it("refuses a reflected hello (our own) as a link to oneself, closing 4002", () => {
    const verdict = verifyHello(helloA, { ownNodeId: ids.a });
    expect(verdict).toEqual({ ok: false, reason: "self" });
    expect(closeCodeFor("self")).toBe(4002);
    expect(closeCodeFor("id-mismatch")).toBe(1008);
  });

  it("refuses a different key at a pinned id", () => {
    expect(verifyHello(helloB, { ownNodeId: ids.a, pinnedNodeId: ids.b })).toEqual({ ok: true });
    expect(verifyHello(helloB, { ownNodeId: ids.a, pinnedNodeId: "other" })).toEqual({
      ok: false,
      reason: "pin-mismatch",
    });
  });

  it("refuses a proof signed by another key", () => {
    const forged = createProof(generateNodeKeys(), helloA);
    expect(verifyProof(forged, { ownHello: helloA, peerHello: helloB })).toEqual({
      ok: false,
      reason: "bad-payload",
    });
    const wrongKey = { ...createProof(b, helloA), sig: createProof(generateNodeKeys(), helloA).sig };
    expect(verifyProof(wrongKey, { ownHello: helloA, peerHello: helloB })).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("refuses a replayed proof from an older session (another nonce)", () => {
    const older = createHello(a, info);
    const stolen = createProof(b, older);
    expect(verifyProof(stolen, { ownHello: helloA, peerHello: helloB })).toEqual({
      ok: false,
      reason: "bad-payload",
    });
  });

  it("refuses a reflected proof (our own proof echoed back)", () => {
    const mine = createProof(a, helloB);
    expect(verifyProof(mine, { ownHello: helloA, peerHello: helloB })).toEqual({
      ok: false,
      reason: "bad-payload",
    });
  });

  it("refuses a proof of another domain tag that would verify as a signature", () => {
    const payload = signedPayload(DOMAIN_TAGS.announce, helloA.nonce, ids.b, ids.a);
    const proof = { type: "proof" as const, payload, sig: signPayload(b, payload) };
    expect(verifyProof(proof, { ownHello: helloA, peerHello: helloB })).toEqual({
      ok: false,
      reason: "bad-payload",
    });
  });
});
