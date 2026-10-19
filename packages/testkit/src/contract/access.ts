import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const PEER = "203.0.113.7";

async function link(target: ContractTarget, name = "Safari on iPhone", kind: "device" | "node" = "device") {
  const minted = await target.core.access.mintPairing({ kind });
  return target.core.access.redeemPairing({ code: minted.code, deviceName: name, peer: PEER });
}

export function accessCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("access", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[access] a link code makes a device with its own secret, once, and announces it", async () => {
      const { core } = target;
      const { changes, stop } = collectChanges(core);
      const minted = await core.access.mintPairing({ kind: "device" });
      expect(minted.code).toMatch(/^[0-9a-f]{32}$/);
      expect(minted.shortCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      const redeemed = await core.access.redeemPairing({
        code: minted.code,
        deviceName: "Safari on iPhone",
        peer: PEER,
      });
      stop();
      expect(redeemed.kind).toBe("device");
      expect(await core.access.verifyDevice(redeemed.secret)).toEqual({ deviceId: redeemed.deviceId });
      await rejectsWithCode(
        core.access.redeemPairing({ code: minted.code, deviceName: "Again", peer: PEER }),
        "unauthorized",
      );
      expect(changes).toContainEqual({ resource: "devices" });
    });

    test("[access] the short code redeems too, in any case", async () => {
      const { core } = target;
      const minted = await core.access.mintPairing({ kind: "device" });
      const redeemed = await core.access.redeemPairing({
        code: minted.shortCode.toLowerCase(),
        deviceName: "Laptop",
        peer: PEER,
      });
      expect(await core.access.verifyDevice(redeemed.secret)).toBeDefined();
    });

    test("[access] lists devices with `current` for the asking device only, and renames and revokes", async () => {
      const { core } = target;
      const first = await link(target, "Safari on iPhone");
      const second = await link(target, "Firefox on Linux");
      const listed = await core.access.listDevices(first.deviceId);
      expect(listed.map((device) => [device.id, device.current])).toEqual(
        expect.arrayContaining([
          [first.deviceId, true],
          [second.deviceId, false],
        ]),
      );
      await core.access.renameDevice(second.deviceId, "Work laptop");
      expect((await core.access.listDevices()).find((d) => d.id === second.deviceId)?.name).toBe(
        "Work laptop",
      );
      await core.access.revokeDevice(second.deviceId);
      await core.access.revokeDevice(second.deviceId);
      expect(await core.access.verifyDevice(second.secret)).toBeUndefined();
      await rejectsWithCode(core.access.renameDevice(second.deviceId, "Gone"), "not_found");
    });

    test("[access] a node secret is not a device secret, and the other way round", async () => {
      const { core } = target;
      const device = await link(target, "Safari on iPhone");
      const node = await link(target, "homelab", "node");
      expect(node.kind).toBe("node");
      expect(await core.access.verifyNode(node.secret)).toEqual({ deviceId: node.deviceId });
      expect(await core.access.verifyDevice(node.secret)).toBeUndefined();
      expect(await core.access.verifyNode(device.secret)).toBeUndefined();
      const listed = await core.access.listDevices(node.deviceId);
      expect(listed.find((entry) => entry.id === node.deviceId)).toMatchObject({
        kind: "node",
        current: false,
      });
    });

    test("[access] sign out all drops devices but keeps nodes", async () => {
      const { core } = target;
      const device = await link(target);
      const node = await link(target, "homelab", "node");
      await core.access.signOutAll();
      expect(await core.access.verifyDevice(device.secret)).toBeUndefined();
      expect(await core.access.verifyNode(node.secret)).toBeDefined();
    });

    test("[access] a wrong code is a generic 401, and five failures lock the peer", async () => {
      const { core } = target;
      const minted = await core.access.mintPairing({ kind: "device" });
      for (let attempt = 0; attempt < 5; attempt++) {
        await rejectsWithCode(
          core.access.redeemPairing({ code: "nope", deviceName: "x", peer: PEER }),
          "unauthorized",
        );
      }
      await rejectsWithCode(
        core.access.redeemPairing({ code: minted.code, deviceName: "x", peer: PEER }),
        "unauthorized",
      );
      const other = await core.access.redeemPairing({
        code: minted.code,
        deviceName: "x",
        peer: "198.51.100.1",
      });
      expect(other.deviceId).toBeTruthy();
    });

    test("[access] at most five codes stay live: the oldest is dropped", async () => {
      const { core } = target;
      const first = await core.access.mintPairing({ kind: "device" });
      for (let index = 0; index < 5; index++) await core.access.mintPairing({ kind: "device" });
      await rejectsWithCode(
        core.access.redeemPairing({ code: first.code, deviceName: "x", peer: PEER }),
        "unauthorized",
      );
    });
  });
}
