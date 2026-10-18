import { HUB_LINK_NONE, PROTOCOL_VERSION } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const HELLO = {
  name: "Homelab",
  os: "linux",
  tauVersion: "1.2.3",
  protocolVersion: PROTOCOL_VERSION,
  threadCount: 2,
};

async function linkMachine(target: ContractTarget, name = "Homelab") {
  const { core } = target;
  const minted = await core.access.mintPairing({ kind: "machine" });
  const redeemed = await core.access.redeemPairing({
    code: minted.code,
    deviceName: name,
    peer: "203.0.113.7",
  });
  const verified = await core.access.verifyMachine(redeemed.secret);
  expect(verified).toEqual({ deviceId: redeemed.deviceId });
  return redeemed.deviceId;
}

export function machinesCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("machines", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[machines] a registered machine is listed online with its hello, and announces it", async () => {
      const { core } = target;
      expect(await core.machines.list()).toEqual([]);
      const id = await linkMachine(target);
      const { changes, stop } = collectChanges(core);
      const machine = await core.machines.register(id, HELLO);
      stop();
      expect(machine).toMatchObject({ id, name: "Homelab", os: "linux", status: "online", threadCount: 2 });
      expect(await core.machines.list()).toEqual([machine]);
      expect(changes).toContainEqual({ resource: "machines" });
    });

    test("[machines] a different protocol version is update-required, never online", async () => {
      const { core } = target;
      const id = await linkMachine(target);
      const machine = await core.machines.register(id, { ...HELLO, protocolVersion: "other" });
      expect(machine).toMatchObject({ status: "update-required", protocolVersion: "other" });
    });

    test("[machines] markOffline keeps the machine and its last seen time; a heartbeat refreshes the count", async () => {
      const { core } = target;
      const id = await linkMachine(target);
      await core.machines.register(id, HELLO);
      core.machines.heartbeat(id, 5);
      expect((await core.machines.list())[0]).toMatchObject({ status: "online", threadCount: 5 });
      core.machines.markOffline(id);
      const [machine] = await core.machines.list();
      expect(machine).toMatchObject({ id, status: "offline", threadCount: 5 });
      expect(machine?.lastSeenAt).toBeGreaterThan(0);
    });

    test("[machines] rename changes the name and rejects an unknown id", async () => {
      const { core } = target;
      const id = await linkMachine(target);
      await core.machines.register(id, HELLO);
      await core.machines.rename(id, "NAS");
      expect((await core.machines.list())[0]?.name).toBe("NAS");
      await rejectsWithCode(core.machines.rename("nope", "x"), "not_found");
    });

    test("[machines] disconnect revokes the machine secret, drops its summary and is idempotent", async () => {
      const { core } = target;
      const minted = await core.access.mintPairing({ kind: "machine" });
      const redeemed = await core.access.redeemPairing({
        code: minted.code,
        deviceName: "Homelab",
        peer: "203.0.113.7",
      });
      await core.machines.register(redeemed.deviceId, HELLO);
      await core.machines.writeSummary(redeemed.deviceId, { savedAt: 1, projects: [], threads: [] });
      await core.machines.disconnect(redeemed.deviceId);
      expect(await core.machines.list()).toEqual([]);
      expect(await core.access.verifyMachine(redeemed.secret)).toBeUndefined();
      expect(await core.machines.readSummary(redeemed.deviceId)).toBeUndefined();
      await core.machines.disconnect(redeemed.deviceId);
    });

    test("[machines] a summary round-trips titles and times, and is absent before the first write", async () => {
      const { core } = target;
      const id = await linkMachine(target);
      await core.machines.register(id, HELLO);
      expect(await core.machines.readSummary(id)).toBeUndefined();
      const summary = {
        savedAt: 42,
        projects: [{ id: "p1", name: "api" }],
        threads: [{ id: "c1", projectId: "p1", title: "Fix login", updatedAt: 40 }],
      };
      await core.machines.writeSummary(id, summary);
      expect(await core.machines.readSummary(id)).toEqual(summary);
    });

    test("[machines] the hub link starts as none, follows reportLink and announces it", async () => {
      const { core } = target;
      expect(await core.machines.hubState()).toEqual(HUB_LINK_NONE);
      const { changes, stop } = collectChanges(core);
      const linked = {
        state: "linked",
        hubName: "Homelab",
        hubUrl: "https://x.test",
        since: 7,
        message: null,
      } as const;
      core.machines.reportLink(linked);
      stop();
      expect(await core.machines.hubState()).toEqual(linked);
      expect(changes).toContainEqual({ resource: "machines" });
      await core.machines.disconnectHub();
      expect(await core.machines.hubState()).toEqual(HUB_LINK_NONE);
    });
  });
}
