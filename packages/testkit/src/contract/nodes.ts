import { PROTOCOL_VERSION } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const HELLO = {
  name: "Homelab",
  os: "linux",
  tauVersion: "1.2.3",
  protocolVersion: PROTOCOL_VERSION,
};
const PEER_ID = "peerabcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopq";
const PEER_KEY = "k".repeat(43);

async function linkNode(target: ContractTarget, name = "Homelab") {
  const { core } = target;
  const minted = await core.access.mintPairing({ kind: "node" });
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
      const node = await core.nodes.register(id, HELLO, "accepted");
      stop();
      expect(node).toMatchObject({ id, name: "Homelab", os: "linux", status: "online", identified: false });
      expect(node.links).toMatchObject([{ direction: "accepted", state: "linked" }]);
      expect(await core.nodes.list()).toEqual([node]);
      expect(changes).toContainEqual({ resource: "nodes" });
    });

    test("[nodes] a different protocol version is update-required, never online", async () => {
      const { core } = target;
      const id = await linkNode(target);
      const node = await core.nodes.register(id, { ...HELLO, protocolVersion: "other" }, "accepted");
      expect(node).toMatchObject({
        status: "update-required",
        protocolVersion: "other",
        tauVersion: HELLO.tauVersion,
      });
    });

    test("[nodes] markOffline keeps the node and its last seen time; a heartbeat refreshes the count", async () => {
      const { core } = target;
      const id = await linkNode(target);
      await core.nodes.register(id, HELLO, "accepted");
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
      await core.nodes.register(id, HELLO, "accepted");
      await core.nodes.rename(id, "NAS");
      expect((await core.nodes.list())[0]?.name).toBe("NAS");
      await rejectsWithCode(core.nodes.rename("nope", "x"), "not_found");
    });

    test("[nodes] disconnect revokes the node secret, drops its summary and is idempotent", async () => {
      const { core } = target;
      const minted = await core.access.mintPairing({ kind: "node" });
      const redeemed = await core.access.redeemPairing({
        code: minted.code,
        deviceName: "Homelab",
        peer: "203.0.113.7",
      });
      await core.nodes.register(redeemed.deviceId, HELLO, "accepted");
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
      await core.nodes.register(id, HELLO, "accepted");
      expect(await core.nodes.readSummary(id)).toBeUndefined();
      const summary = {
        savedAt: 42,
        projects: [{ id: "p1", name: "api" }],
        threads: [{ id: "c1", projectId: "p1", title: "Fix login", updatedAt: 40 }],
      };
      await core.nodes.writeSummary(id, summary);
      expect(await core.nodes.readSummary(id)).toEqual(summary);
    });

    test("[nodes] self has a stable id and a name, signs a payload and lists no capability yet", async () => {
      const { core } = target;
      const self = await core.nodes.self();
      expect(self.nodeId.length).toBeGreaterThan(0);
      expect(self.name.length).toBeGreaterThan(0);
      expect(self.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(self.capabilities).toEqual([]);
      expect((await core.nodes.self()).nodeId).toBe(self.nodeId);
      expect((await core.nodes.sign("tau-proof-v1|a|b|c")).length).toBeGreaterThan(0);
    });

    test("[nodes] a verified hello binds the peer's nodeId: the node is listed under it", async () => {
      const { core } = target;
      const deviceId = await linkNode(target);
      const node = await core.nodes.register(
        deviceId,
        { ...HELLO, nodeId: PEER_ID, publicKey: PEER_KEY },
        "accepted",
      );
      expect(node).toMatchObject({ id: PEER_ID, identified: true });
      expect((await core.nodes.list()).map((listed) => listed.id)).toEqual([PEER_ID]);
      await core.nodes.rename(PEER_ID, "NAS");
      expect((await core.nodes.list())[0]?.name).toBe("NAS");
    });

    test("[nodes] forget drops the peer and its secret on this node only, and is idempotent", async () => {
      const { core } = target;
      const minted = await core.access.mintPairing({ kind: "node" });
      const redeemed = await core.access.redeemPairing({
        code: minted.code,
        deviceName: "Homelab",
        peer: "203.0.113.7",
      });
      await core.nodes.register(redeemed.deviceId, HELLO, "accepted");
      await core.nodes.forget(redeemed.deviceId);
      expect(await core.nodes.list()).toEqual([]);
      expect(await core.access.verifyNode(redeemed.secret)).toBeUndefined();
      await core.nodes.forget(redeemed.deviceId);
    });

    test("[nodes] resetIdentity gives a new nodeId and drops every peer", async () => {
      const { core } = target;
      const before = (await core.nodes.self()).nodeId;
      const id = await linkNode(target);
      await core.nodes.register(id, HELLO, "accepted");
      const { changes, stop } = collectChanges(core);
      await core.nodes.resetIdentity();
      stop();
      expect((await core.nodes.self()).nodeId).not.toBe(before);
      expect(await core.nodes.list()).toEqual([]);
      expect(changes).toContainEqual({ resource: "nodes" });
    });

    test("[nodes-symmetric] a dialled peer reports its link state per peer and announces it", async () => {
      const { core, dialPeer } = target;
      const peerId = await (dialPeer as NonNullable<typeof dialPeer>)("Mac");
      const { changes, stop } = collectChanges(core);
      core.nodes.reportLink(peerId, { state: "reconnecting", message: "Node unreachable", since: 7 });
      stop();
      const node = (await core.nodes.list()).find((listed) => listed.id === peerId);
      expect(node?.links).toEqual([
        { direction: "dialled", state: "reconnecting", message: "Node unreachable", since: 7 },
      ]);
      expect(changes).toContainEqual({ resource: "nodes" });
    });

    test("[nodes-symmetric] a peer that dialled us and that we dial is one node with two links", async () => {
      const { core, dialPeer } = target;
      const peerId = await (dialPeer as NonNullable<typeof dialPeer>)("Mac");
      const deviceId = await linkNode(target);
      const info = { ...HELLO, nodeId: PEER_ID, publicKey: PEER_KEY };
      await core.nodes.register(peerId, info, "dialled");
      await core.nodes.register(deviceId, info, "accepted");
      const nodes = await core.nodes.list();
      expect(nodes.map((node) => node.id)).toEqual([PEER_ID]);
      expect(nodes[0]?.links.map((link) => link.direction).sort()).toEqual(["accepted", "dialled"]);
    });
  });
}
