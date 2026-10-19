import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
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
  });
  const link = async (kind: "device" | "machine" = "device", name = "Safari") => {
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
    const node = await link("machine", "homelab");
    expect(await access.verifyDevice(node.secret)).toBeUndefined();
    expect(await access.verifyNode(device.secret)).toBeUndefined();
    await access.signOutAll();
    expect(await access.verifyDevice(device.secret)).toBeUndefined();
    expect(await access.verifyNode(node.secret)).toBeDefined();
    await access.revokeDevice(node.deviceId);
    expect(await access.verifyNode(node.secret)).toBeUndefined();
  });
});
