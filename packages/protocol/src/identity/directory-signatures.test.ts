import { describe, expect, it } from "vitest";
import { createAnnounce, verifyAnnounce } from "./announce";
import { createAck, createExpel, verifyAck, verifyExpel } from "./expel";
import { generateNodeKeys, nodeIdOf, signPayload } from "./keys";
import { createNonceCache } from "./nonce-cache";
import { signRequestHeader, verifyRequestHeader } from "./request-header";
import { compareSequence, isNewerSequence, nextBoot } from "./sequence";
import { DOMAIN_TAGS } from "./signed-payload";
import { skewMs, withinWindow } from "./time-window";

const body = {
  boot: 1000,
  counter: 0,
  name: "Home|lab é",
  os: "linux x64",
  tauVersion: "0.3.0",
  protocolVersion: "p",
  linkProtocol: "l",
  threadCount: 3,
  neighbours: ["b", "c"],
};

describe("announce (pin r3)", () => {
  it("round-trips, with the key in the payload and free text percent-encoded", () => {
    const keys = generateNodeKeys();
    const verdict = verifyAnnounce(createAnnounce(keys, body, 16));
    expect(verdict).toMatchObject({
      ok: true,
      record: { origin: nodeIdOf(keys.publicKey), name: "Home|lab é", neighbours: ["b", "c"] },
    });
  });

  it("refuses a forged origin (key does not hash to the id), a wrong signature and a wrong key for a known id", () => {
    const keys = generateNodeKeys();
    const frame = createAnnounce(keys, body, 16);
    const [tag, , ...rest] = frame.payload.split("|");
    const forged = [tag, "forgedid", ...rest].join("|");
    expect(verifyAnnounce({ payload: forged, sig: frame.sig })).toMatchObject({
      ok: false,
      reason: "bad-key",
    });
    const tampered = frame.payload.replace("%C3%A9", "e");
    expect(verifyAnnounce({ payload: tampered, sig: frame.sig })).toMatchObject({
      ok: false,
      reason: "bad-signature",
    });
    const other = generateNodeKeys();
    expect(verifyAnnounce(frame, { knownKey: other.publicKey })).toMatchObject({
      ok: false,
      reason: "key-mismatch",
    });
    const swapped = createAnnounce(other, body, 16);
    expect(verifyAnnounce({ payload: frame.payload, sig: swapped.sig })).toMatchObject({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("refuses oversized lists, a list naming the origin and malformed numbers; a huge counter needs the key", () => {
    const keys = generateNodeKeys();
    const many = Array.from({ length: 16 }, (_, i) => `n${i}`);
    expect(verifyAnnounce(createAnnounce(keys, { ...body, neighbours: many }, 16))).toMatchObject({
      ok: false,
      reason: "too-many-neighbours",
    });
    expect(
      verifyAnnounce(createAnnounce(keys, { ...body, neighbours: [nodeIdOf(keys.publicKey)] }, 16)),
    ).toMatchObject({ ok: false });
    const frame = createAnnounce(keys, body, 16);
    const huge = frame.payload.replace("|1000|0|", "|99999999999999999999|0|");
    expect(verifyAnnounce({ payload: huge, sig: frame.sig })).toMatchObject({
      ok: false,
      reason: "bad-payload",
    });
    const forgedCounter = frame.payload.replace("|1000|0|", "|1000|9007199254740991|");
    expect(verifyAnnounce({ payload: forgedCounter, sig: frame.sig })).toMatchObject({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("a signature of another domain cannot be replayed as an announce", () => {
    const keys = generateNodeKeys();
    const frame = createAnnounce(keys, body, 16);
    const wrongTag = frame.payload.replace(DOMAIN_TAGS.announce, DOMAIN_TAGS.expel);
    expect(verifyAnnounce({ payload: wrongTag, sig: signPayload(keys, wrongTag) })).toMatchObject({
      ok: false,
      reason: "bad-payload",
    });
  });
});

describe("sequence (boot, counter)", () => {
  it("orders lexicographically; a record that is not newer is dropped", () => {
    expect(compareSequence({ boot: 2, counter: 0 }, { boot: 1, counter: 99 })).toBe(1);
    expect(isNewerSequence({ boot: 1, counter: 1 }, { boot: 1, counter: 1 })).toBe(false);
    expect(isNewerSequence({ boot: 1, counter: 2 }, { boot: 1, counter: 1 })).toBe(true);
    expect(isNewerSequence({ boot: 1, counter: 0 }, undefined)).toBe(true);
  });

  it("boot moves forward even when the clock is set back", () => {
    expect(nextBoot(5000, 4000)).toBe(5001);
    expect(nextBoot(5000, 9000)).toBe(9000);
  });
});

describe("expel and ack", () => {
  it("verifies by the key it carries, with no 'seen before' rule", () => {
    const by = generateNodeKeys();
    const verdict = verifyExpel(createExpel(by, "target", 5));
    expect(verdict).toMatchObject({
      ok: true,
      record: { target: "target", by: nodeIdOf(by.publicKey), time: 5 },
    });
  });

  it("ignores a forged expel: bad signature, wrong by, self-expel, wrong domain", () => {
    const by = generateNodeKeys();
    const frame = createExpel(by, "target", 5);
    expect(verifyExpel({ ...frame, payload: frame.payload.replace("target", "other") })).toMatchObject({
      ok: false,
      reason: "bad-signature",
    });
    expect(verifyExpel({ ...frame, byPublicKey: generateNodeKeys().publicKey })).toMatchObject({
      ok: false,
      reason: "bad-key",
    });
    expect(verifyExpel(createExpel(by, nodeIdOf(by.publicKey), 5))).toMatchObject({
      ok: false,
      reason: "self-expel",
    });
    const ack = createAck(by, "target", 5);
    expect(verifyExpel({ payload: ack.payload, byPublicKey: by.publicKey, sig: ack.sig })).toMatchObject({
      ok: false,
    });
  });

  it("an ack is signed by the node that applied the expel", () => {
    const node = generateNodeKeys();
    expect(verifyAck(createAck(node, "target", 9))).toMatchObject({
      ok: true,
      record: { target: "target", node: nodeIdOf(node.publicKey) },
    });
    const frame = createAck(node, "target", 9);
    expect(verifyAck({ ...frame, nodePublicKey: generateNodeKeys().publicKey })).toMatchObject({
      ok: false,
      reason: "bad-key",
    });
  });
});

describe("routed request header (pin r7)", () => {
  const origin = generateNodeKeys();
  const dest = generateNodeKeys();
  const destId = nodeIdOf(dest.publicKey);
  const fields = {
    dest: destId,
    method: "POST",
    path: "/api/x|y",
    query: "a=1&b=|",
    contentType: "application/json",
    bodyBytes: 12,
    via: "Phone",
  };
  const NOW = 1_000_000;
  const context = (over: object = {}) => ({
    ownNodeId: destId,
    now: NOW,
    bootAt: NOW - 200_000,
    nonces: createNonceCache(() => NOW),
    ...over,
  });
  const signed = (at = NOW, nonce?: string) => ({
    ...fields,
    ...signRequestHeader(origin, fields, at, nonce),
  });

  it("accepts a signed header and names the verified origin", () => {
    expect(verifyRequestHeader(signed(), context())).toEqual({
      ok: true,
      origin: nodeIdOf(origin.publicKey),
      ts: NOW,
    });
  });

  it("refuses a ts beyond ±120 s and reports the skew; accepts exactly the edge", () => {
    expect(verifyRequestHeader(signed(NOW - 121_000), context())).toEqual({
      ok: false,
      reason: "skew",
      skewMs: -121_000,
    });
    expect(verifyRequestHeader(signed(NOW + 130_000), context())).toMatchObject({
      ok: false,
      reason: "skew",
      skewMs: 130_000,
    });
    expect(verifyRequestHeader(signed(NOW - 120_000), context())).toMatchObject({ ok: true });
    expect(withinWindow(NOW + 120_001, NOW)).toBe(false);
    expect(skewMs(NOW + 5, NOW)).toBe(5);
  });

  it("refuses a replay inside the window, but a forged one cannot burn nonces", () => {
    const ctx = context();
    const frame = signed(NOW, "n1");
    expect(verifyRequestHeader(frame, ctx)).toMatchObject({ ok: true });
    expect(verifyRequestHeader(frame, ctx)).toMatchObject({ ok: false, reason: "replay" });
    const forged = { ...signed(NOW, "n2"), originSig: frame.originSig };
    expect(verifyRequestHeader(forged, ctx)).toMatchObject({ ok: false, reason: "bad-signature" });
    expect(verifyRequestHeader(signed(NOW, "n2"), ctx)).toMatchObject({ ok: true });
  });

  it("refuses a ts before the destination's boot (the nonce cache was lost)", () => {
    expect(verifyRequestHeader(signed(NOW - 60_000), context({ bootAt: NOW - 1000 }))).toMatchObject({
      ok: false,
      reason: "before-boot",
    });
  });

  it("refuses swapped fields, another destination, a wrong key and a tombstoned origin", () => {
    expect(verifyRequestHeader({ ...signed(), path: "/api/other" }, context())).toMatchObject({
      ok: false,
      reason: "mismatch",
    });
    expect(verifyRequestHeader({ ...signed(), bodyBytes: 13 }, context())).toMatchObject({
      ok: false,
      reason: "mismatch",
    });
    expect(verifyRequestHeader(signed(), context({ ownNodeId: "someone-else" }))).toMatchObject({
      ok: false,
      reason: "wrong-dest",
    });
    expect(
      verifyRequestHeader({ ...signed(), originPublicKey: generateNodeKeys().publicKey }, context()),
    ).toMatchObject({ ok: false, reason: "bad-key" });
    expect(verifyRequestHeader(signed(), context({ isTombstoned: () => true }))).toMatchObject({
      ok: false,
      reason: "tombstoned",
    });
    expect(verifyRequestHeader({ ...fields }, context())).toMatchObject({ ok: false, reason: "missing" });
  });
});

describe("nonce cache", () => {
  it("is bounded and forgets entries after twice the window", () => {
    let now = 0;
    const cache = createNonceCache(() => now, 3, 1000);
    for (const key of ["a", "b", "c", "d"]) expect(cache.accept(key)).toBe(true);
    expect(cache.size()).toBe(3);
    expect(cache.accept("a")).toBe(true);
    now = 5000;
    expect(cache.accept("d")).toBe(true);
  });
});
