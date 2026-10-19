import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createAccess } from "./create-access";
import { createFileDeviceStore } from "./file-device-store";
import { createMemoryDeviceStore } from "./memory-device-store";
import { peerBucket } from "./redeem-limits";

const PEER = "203.0.113.7";

function setup(store = createMemoryDeviceStore()) {
  const clock = { t: 1_000_000 };
  const access = createAccess({
    store,
    now: () => clock.t,
    randomBytes: (n) => randomBytes(n),
    remoteUrl: () => "https://x.example",
    announce: () => undefined,
    nodeId: () => "ownnode",
  });
  const link = async (kind: "device" | "node" = "device", name = "Safari") => {
    const m = await access.mintPairing({ kind });
    return access.redeemPairing({ code: m.code, deviceName: name, peer: PEER });
  };
  const fail = async (peer = PEER, code = "nope") =>
    access.redeemPairing({ code, deviceName: "x", peer }).catch((e: unknown) => e);
  return { access, clock, link, fail };
}

describe("access", () => {
  test("codes expire after five minutes", async () => {
    const { access, clock } = setup();
    const m = await access.mintPairing({ kind: "device" });
    clock.t += 5 * 60_000 + 1;
    await expect(access.redeemPairing({ code: m.code, deviceName: "x", peer: PEER })).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  test("only five codes stay live", async () => {
    const { access } = setup();
    const first = await access.mintPairing({});
    for (let i = 0; i < 5; i++) await access.mintPairing({});
    await expect(
      access.redeemPairing({ code: first.shortCode, deviceName: "x", peer: PEER }),
    ).rejects.toBeDefined();
  });

  test("failures never burn a code and five lock the peer for ten minutes", async () => {
    const { access, clock, fail } = setup();
    const m = await access.mintPairing({});
    for (let i = 0; i < 5; i++) await fail();
    await expect(access.redeemPairing({ code: m.code, deviceName: "x", peer: PEER })).rejects.toBeDefined();
    clock.t += 10 * 60_000 + 1;
    const fresh = await access.mintPairing({});
    expect(
      (await access.redeemPairing({ code: fresh.code, deviceName: "x", peer: PEER })).deviceId,
    ).toBeTruthy();
  });

  test("the IPv6 /64 and local peers share buckets", () => {
    expect(peerBucket("2001:db8:1:2::1")).toBe(peerBucket("2001:db8:1:2:ffff::9"));
    expect(peerBucket("2001:db8:1:3::1")).not.toBe(peerBucket("2001:db8:1:2::1"));
    expect(peerBucket("")).toBe(peerBucket("127.0.0.1"));
    expect(peerBucket("::1")).toBe(peerBucket("local"));
  });

  test("the global backstop locks short codes only", async () => {
    const { access, fail } = setup();
    const m = await access.mintPairing({});
    for (let i = 0; i < 100; i++) await fail(`198.51.${Math.floor(i / 250)}.${i % 250}`);
    await expect(
      access.redeemPairing({ code: m.shortCode, deviceName: "x", peer: "192.0.2.1" }),
    ).rejects.toBeDefined();
    expect(
      (await access.redeemPairing({ code: m.code, deviceName: "x", peer: "192.0.2.1" })).deviceId,
    ).toBeTruthy();
  });

  test("the secret is hashed at rest and never in devices.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tau-access-"));
    const file = join(dir, "devices.json");
    const { link } = setup(createFileDeviceStore(file));
    const { secret } = await link();
    const text = await readFile(file, "utf8");
    expect(text).not.toContain(secret);
    expect(text).toContain("secretHash");
  });

  test("devices survive a restart", async () => {
    const store = createMemoryDeviceStore();
    const { link } = setup(store);
    const { secret, deviceId } = await link();
    expect(await setup(store).access.verifyDevice(secret)).toEqual({ deviceId });
  });

  test("touch is throttled to once a minute", async () => {
    const { access, clock, link } = setup();
    const { deviceId } = await link();
    const seen = async () => (await access.listDevices())[0]?.lastSeenAt;
    const created = clock.t;
    clock.t += 30_000;
    access.touch(deviceId);
    await new Promise((r) => setTimeout(r, 5));
    expect(await seen()).toBe(created);
    clock.t += 31_000;
    access.touch(deviceId);
    await new Promise((r) => setTimeout(r, 5));
    expect(await seen()).toBe(clock.t);
  });

  test("node and device secrets do not cross, sign out keeps nodes, revoke works", async () => {
    const { access, link } = setup();
    const device = await link();
    const node = await link("node", "homelab");
    expect(await access.verifyDevice(node.secret)).toBeUndefined();
    expect(await access.verifyNode(device.secret)).toBeUndefined();
    await access.signOutAll();
    expect(await access.verifyDevice(device.secret)).toBeUndefined();
    expect(await access.verifyNode(node.secret)).toBeDefined();
    await access.revokeDevice(node.deviceId);
    expect(await access.verifyNode(node.secret)).toBeUndefined();
  });
});

describe("node devices (MVP13 Step 1)", () => {
  const KEY = "k".repeat(43);

  test("a node pairing carries this node's id in the redeem response, the link and the minted code", async () => {
    const { access } = setup();
    const minted = await access.mintPairing({ kind: "node", name: "Phone" });
    expect(minted.nodeId).toBe("ownnode");
    expect(minted.link).toContain("&node=ownnode");
    const redeemed = await access.redeemPairing({ code: minted.code, deviceName: "x", peer: PEER });
    expect(redeemed).toMatchObject({ kind: "node", nodeId: "ownnode" });
    const device = await access.mintPairing({ kind: "device" });
    expect(
      (await access.redeemPairing({ code: device.code, deviceName: "Safari", peer: PEER })).nodeId,
    ).toBeUndefined();
  });

  test('the file stays kind "machine" on disk, reads back as node, and keeps nodeId and publicKey', async () => {
    const dir = await mkdtemp(join(tmpdir(), "tau-access-"));
    const file = join(dir, "devices.json");
    const { access, link } = setup(createFileDeviceStore(file));
    const node = await link("node", "homelab");
    expect(await access.bindNodeIdentity(node.deviceId, { nodeId: "peer1", publicKey: KEY })).toEqual({
      ok: true,
    });
    const onDisk = JSON.parse(await readFile(file, "utf8")) as Array<Record<string, unknown>>;
    expect(onDisk[0]).toMatchObject({ kind: "machine", nodeId: "peer1", publicKey: KEY });
    const again = setup(createFileDeviceStore(file)).access;
    expect(await again.listDevices()).toMatchObject([{ kind: "node", nodeId: "peer1" }]);
    expect(JSON.stringify(await again.listDevices())).not.toContain(KEY);
    expect(await again.verifyNode(node.secret)).toBeDefined();
  });

  test("a nodeId given at redeem makes the device one node before any hello, and the hello adds the key", async () => {
    const { access } = setup();
    const id = "a".repeat(52);
    const m = await access.mintPairing({ kind: "node" });
    const redeemed = await access.redeemPairing({ code: m.code, deviceName: "B", peer: PEER, nodeId: id });
    expect((await access.listDevices("")).map((device) => device.nodeId)).toEqual([id]);
    expect(await access.bindNodeIdentity(redeemed.deviceId, { nodeId: id, publicKey: KEY })).toEqual({
      ok: true,
    });
    expect(
      await access.bindNodeIdentity(redeemed.deviceId, { nodeId: "b".repeat(52), publicKey: KEY }),
    ).toMatchObject({
      ok: false,
      reason: "identity-conflict",
    });
  });

  test("a junk nodeId at redeem is ignored and a device pairing never takes one", async () => {
    const { access } = setup();
    const node = await access.mintPairing({ kind: "node" });
    await access.redeemPairing({ code: node.code, deviceName: "B", peer: PEER, nodeId: "not an id" });
    const device = await access.mintPairing({ kind: "device" });
    await access.redeemPairing({
      code: device.code,
      deviceName: "Safari",
      peer: PEER,
      nodeId: "a".repeat(52),
    });
    expect((await access.listDevices("")).map((entry) => entry.nodeId)).toEqual([undefined, undefined]);
  });

  test("reads a 0.1.x devices.json (kind machine, no ids) and a file that already says node", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tau-access-"));
    const file = join(dir, "devices.json");
    const base = { createdAt: 1, lastSeenAt: 2, secretHash: "h" };
    await writeFile(
      file,
      JSON.stringify([
        { id: "a", name: "Old", kind: "machine", ...base },
        { id: "b", name: "New", kind: "node", ...base },
        { id: "c", name: "Bad", kind: "toaster", ...base },
      ]),
    );
    const devices = await createFileDeviceStore(file).read();
    expect(devices.map((device) => [device.id, device.kind])).toEqual([
      ["a", "node"],
      ["b", "node"],
    ]);
  });

  test("a node identity is never overwritten and a held nodeId is reported as a duplicate", async () => {
    const { access, link } = setup();
    const first = await link("node", "a");
    const second = await link("node", "b");
    expect(await access.bindNodeIdentity(first.deviceId, { nodeId: "peer1", publicKey: KEY })).toEqual({
      ok: true,
    });
    expect(await access.bindNodeIdentity(first.deviceId, { nodeId: "peer1", publicKey: KEY })).toEqual({
      ok: true,
    });
    expect(await access.bindNodeIdentity(first.deviceId, { nodeId: "peer2", publicKey: KEY })).toEqual({
      ok: false,
      reason: "identity-conflict",
    });
    expect(await access.bindNodeIdentity(second.deviceId, { nodeId: "peer1", publicKey: KEY })).toEqual({
      ok: false,
      reason: "duplicate-device",
      otherDeviceId: first.deviceId,
    });
    expect(
      await access.bindNodeIdentity(second.deviceId, { nodeId: "peer1", publicKey: "z".repeat(43) }),
    ).toMatchObject({
      ok: false,
      reason: "identity-conflict",
    });
    expect(await access.bindNodeIdentity("nope", { nodeId: "x", publicKey: KEY })).toMatchObject({
      reason: "not-found",
    });
    expect((await access.findNodeDevice("peer1"))?.id).toBe(first.deviceId);
    expect(await access.findNodeDevice("peer2")).toBeUndefined();
  });

  test("a browser device cannot be bound to a node identity", async () => {
    const { access, link } = setup();
    const device = await link("device");
    expect(await access.bindNodeIdentity(device.deviceId, { nodeId: "p", publicKey: KEY })).toMatchObject({
      reason: "not-found",
    });
  });
});
