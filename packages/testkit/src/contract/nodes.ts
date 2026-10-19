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

async function linkNode(target: ContractTarget, name = "Homelab") {
  const { core } = target;
  const minted = await core.access.mintPairing({ kind: "machine" });
  const redeemed = await core.access.redeemPairing({
    code: minted.code,
    deviceName: name,
    peer: "203.0.113.7",
  });
  const verified = await core.access.verifyNode(redeemed.secret);
  expect(verified).toEqual({ deviceId: redeemed.deviceId });
  return redeemed.deviceId;
}

export function nodesCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("nodes", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[nodes] a registered node is listed online with its hello, and announces it", async () => {
      const { core } = target;
      expect(await core.nodes.list()).toEqual([]);
      const id = await linkNode(target);
      const { changes, stop } = collectChanges(core);
      const node = await core.nodes.register(id, HELLO);
      stop();
      expect(node).toMatchObject({ id, name: "Homelab", os: "linux", status: "online", threadCount: 2 });
      expect(await core.nodes.list()).toEqual([node]);
      expect(changes).toContainEqual({ resource: "nodes" });
    });

    test("[nodes] a different protocol version is update-required, never online", async () => {
      const { core } = target;
      const id = await linkNode(target);
      const node = await core.nodes.register(id, { ...HELLO, protocolVersion: "other" });
      expect(node).toMatchObject({
        status: "update-required",
        protocolVersion: "other",
        tauVersion: HELLO.tauVersion,
      });
    });

    test("[nodes] markOffline keeps the node and its last seen time; a heartbeat refreshes the count", async () => {
      const { core } = target;
      const id = await linkNode(target);
      await core.nodes.register(id, HELLO);
      core.nodes.heartbeat(id, 5);
      expect((await core.nodes.list())[0]).toMatchObject({ status: "online", threadCount: 5 });
      core.nodes.markOffline(id);
      const [node] = await core.nodes.list();
      expect(node).toMatchObject({ id, status: "offline", threadCount: 5 });
      expect(node?.lastSeenAt).toBeGreaterThan(0);
    });

    test("[nodes] rename changes the name and rejects an unknown id", async () => {
      const { core } = target;
      const id = await linkNode(target);
      await core.nodes.register(id, HELLO);
      await core.nodes.rename(id, "NAS");
      expect((await core.nodes.list())[0]?.name).toBe("NAS");
      await rejectsWithCode(core.nodes.rename("nope", "x"), "not_found");
    });

    test("[nodes] disconnect revokes the node secret, drops its summary and is idempotent", async () => {
      const { core } = target;
      const minted = await core.access.mintPairing({ kind: "machine" });
      const redeemed = await core.access.redeemPairing({
        code: minted.code,
        deviceName: "Homelab",
        peer: "203.0.113.7",
      });
      await core.nodes.register(redeemed.deviceId, HELLO);
      await core.nodes.writeSummary(redeemed.deviceId, { savedAt: 1, projects: [], threads: [] });
      await core.nodes.disconnect(redeemed.deviceId);
      expect(await core.nodes.list()).toEqual([]);
      expect(await core.access.verifyNode(redeemed.secret)).toBeUndefined();
      expect(await core.nodes.readSummary(redeemed.deviceId)).toBeUndefined();
      await core.nodes.disconnect(redeemed.deviceId);
    });

    test("[nodes] a summary round-trips titles and times, and is absent before the first write", async () => {
      const { core } = target;
      const id = await linkNode(target);
      await core.nodes.register(id, HELLO);
      expect(await core.nodes.readSummary(id)).toBeUndefined();
      const summary = {
        savedAt: 42,
        projects: [{ id: "p1", name: "api" }],
        threads: [{ id: "c1", projectId: "p1", title: "Fix login", updatedAt: 40 }],
      };
      await core.nodes.writeSummary(id, summary);
      expect(await core.nodes.readSummary(id)).toEqual(summary);
    });

    test("[nodes] the hub link starts as none, follows reportLink and announces it", async () => {
      const { core } = target;
      expect(await core.nodes.hubState()).toMatchObject(HUB_LINK_NONE);
      const { changes, stop } = collectChanges(core);
      const linked = {
        state: "linked",
        hubName: "Homelab",
        hubUrl: "https://x.test",
        since: 7,
        message: null,
      } as const;
      core.nodes.reportLink(linked);
      stop();
      expect(await core.nodes.hubState()).toMatchObject(linked);
      expect(changes).toContainEqual({ resource: "nodes" });
      await core.nodes.disconnectHub();
      expect(await core.nodes.hubState()).toMatchObject(HUB_LINK_NONE);
    });
  });
}
