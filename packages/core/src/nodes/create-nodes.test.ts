import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Change, Device } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChangeEmitter } from "../change-emitter";
import type { Peer } from "../peers/peers-store";
import { createFakeRemoteAdapter } from "../remote/fake-adapter";
import { createRemoteService } from "../remote/remote-service";
import { createNodes } from "./create-nodes";
import { peerIdOf } from "./peer-id";
import { standbyDialDue } from "./standby";

const HELLO = { name: "Homelab", os: "linux", tauVersion: "1", protocolVersion: "v1" };
const SUMMARY = {
  savedAt: 1,
  projects: [{ id: "p", name: "api" }],
  threads: [{ id: "t", projectId: "p", title: "Hi", updatedAt: 2 }],
};

let dir: string;
let clock = 0;
let devices: Device[];
let seen: Change[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tau-nodes-"));
  clock = 1000;
  devices = [{ id: "m1", name: "Homelab", kind: "node", createdAt: 1, lastSeenAt: 1, current: false }];
  seen = [];
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function setup() {
  const changes = createChangeEmitter();
  changes.subscribe((c) => seen.push(c));
  const access = {
    listDevices: async () => devices,
    renameDevice: async (id: string, name: string) => {
      devices = devices.map((d) => (d.id === id ? { ...d, name } : d));
    },
    revokeDevice: async (id: string) => {
      devices = devices.filter((d) => d.id !== id);
    },
    bindNodeIdentity: async (id: string, identity: { nodeId: string; publicKey: string }) => {
      const holder = devices.find((d) => d.id !== id && d.nodeId === identity.nodeId);
      if (holder)
        return { ok: false as const, reason: "duplicate-device" as const, otherDeviceId: holder.id };
      devices = devices.map((d) => (d.id === id ? { ...d, nodeId: identity.nodeId } : d));
      return { ok: true as const };
    },
    findNodeDevice: async (nodeId: string) => devices.find((d) => d.nodeId === nodeId),
  };
  let peers: Peer[] = [];
  const peersStore = {
    read: async () => peers,
    write: async (next: readonly Peer[]) => {
      peers = [...next];
    },
  };
  let identity = {
    nodeId: "self1",
    publicKey: "key",
    createdAt: 1,
    sign: (payload: string) => `sig:${payload}`,
  };
  const nodes = createNodes({
    directory: join(dir, "nodes"),
    now: () => clock,
    changes,
    access,
    peers: peersStore,
    identity: () => identity,
    resetIdentity: async () => {
      identity = { ...identity, nodeId: "self2" };
    },
    protocolVersion: "v1",
    linkProtocol: "l1",
    tauVersion: "0.2.0",
  });
  return { nodes, changes, access, peers: peersStore };
}

describe("node status", () => {
  it("walks online, reconnecting, offline and back with a heartbeat", async () => {
    const { nodes } = setup();
    await nodes.register("m1", HELLO, "accepted");
    const status = async () => (await nodes.list())[0]?.status;
    expect(await status()).toBe("online");
    clock += 14_999;
    expect(await status()).toBe("online");
    clock += 1;
    expect(await status()).toBe("reconnecting");
    clock += 30_000;
    expect(await status()).toBe("offline");
    nodes.heartbeat("m1", 4);
    expect(await status()).toBe("online");
  });

  it("markOffline is immediate and keeps lastSeenAt", async () => {
    const { nodes } = setup();
    await nodes.register("m1", HELLO, "accepted");
    clock += 2000;
    nodes.markOffline("m1");
    expect((await nodes.list())[0]).toMatchObject({ status: "offline", lastSeenAt: 3000 });
  });

  it("a different protocol version is update-required until it goes silent", async () => {
    const { nodes } = setup();
    await nodes.register("m1", { ...HELLO, protocolVersion: "v0" }, "accepted");
    expect((await nodes.list())[0]?.status).toBe("update-required");
    await nodes.writeSummary("m1", SUMMARY);
    expect(await nodes.readSummary("m1")).toBeUndefined();
    clock += 45_000;
    expect((await nodes.list())[0]?.status).toBe("offline");
  });
});

describe("update-required after the hub closed the link", () => {
  it("stays update-required (not offline) so the hub can say why", async () => {
    const { nodes } = setup();
    await nodes.register("m1", { ...HELLO, protocolVersion: "v0" }, "accepted");
    nodes.markOffline("m1");
    expect((await nodes.list())[0]?.status).toBe("update-required");
  });
});

describe("summary cache", () => {
  it("is private, atomic, healthy-only and marked stale on disconnect of the link", async () => {
    const { nodes } = setup();
    await nodes.register("m1", HELLO, "accepted");
    await nodes.writeSummary("m1", { ...SUMMARY, extra: "no" } as typeof SUMMARY);
    const file = join(dir, "nodes", "m1", "summary.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(SUMMARY);
    nodes.markOffline("m1");
    // markOffline writes in the background: wait for the write, a fixed sleep is too short under load.
    await vi.waitFor(async () => expect(JSON.parse(await readFile(file, "utf8")).stale).toBe(true));
    expect(await nodes.readSummary("m1")).toEqual(SUMMARY);
    await nodes.writeSummary("m1", { ...SUMMARY, savedAt: 9 });
    expect((await nodes.readSummary("m1"))?.savedAt).toBe(1);
  });

  it("is deleted on disconnect and announces", async () => {
    const { nodes } = setup();
    await nodes.register("m1", HELLO, "accepted");
    await nodes.writeSummary("m1", SUMMARY);
    seen.length = 0;
    await nodes.disconnect("m1");
    expect(await nodes.readSummary("m1")).toBeUndefined();
    expect(await nodes.list()).toEqual([]);
    expect(seen).toContainEqual({ resource: "nodes" });
  });

  it("is kept when remote is disabled and deleted when recreated", async () => {
    const { nodes, changes } = setup();
    const adapter = createFakeRemoteAdapter(() => clock);
    const service = createRemoteService({
      adapter,
      settings: { setRemoteEnabled: async () => undefined },
      access: {
        clearAll: async () => {
          devices = [];
        },
      },
      changes,
      forgetNodes: () => nodes.reset(),
    });
    await nodes.register("m1", HELLO, "accepted");
    await nodes.writeSummary("m1", SUMMARY);
    await service.api.enable();
    seen.length = 0;
    await service.api.disable();
    expect(await nodes.readSummary("m1")).toBeDefined();
    await service.api.enable();
    adapter.push({ state: "reconnecting", canRecreate: true });
    await service.api.recreate();
    expect(await nodes.readSummary("m1")).toBeUndefined();
    expect(await nodes.list()).toEqual([]);
    expect(seen).toContainEqual({ resource: "nodes" });
  });
});

describe("peers from both directions (Step 1 foundation; owner A deepens)", () => {
  it("lists a dialled peer from peers.json next to an accepted node device", async () => {
    const { nodes, peers } = setup();
    await peers.write([{ url: "https://mac.example", name: "Mac", secret: "s" }]);
    const list = await nodes.list();
    expect(list.map((node) => [node.name, node.links[0]?.direction, node.identified])).toEqual([
      ["Homelab", "accepted", false],
      ["Mac", "dialled", false],
    ]);
  });

  it("keeps a per-peer link report and announces it", async () => {
    const { nodes, peers } = setup();
    const peer = { url: "https://mac.example", name: "Mac", secret: "s" };
    await peers.write([peer]);
    seen.length = 0;
    nodes.reportLink(peerIdOf(peer), { state: "unreachable", message: "Node unreachable", since: 5 });
    const mac = (await nodes.list()).find((node) => node.name === "Mac");
    expect(mac?.links).toEqual([
      { direction: "dialled", state: "unreachable", message: "Node unreachable", since: 5 },
    ]);
    expect(mac?.status).toBe("offline");
    nodes.reportLink(peerIdOf(peer), { state: "linked", message: null, since: 6 });
    expect((await nodes.list()).find((node) => node.name === "Mac")?.status).toBe("online");
    expect(seen).toContainEqual({ resource: "nodes" });
  });

  it("learns a dialled peer's nodeId at its first hello and refuses a different one afterwards", async () => {
    const { nodes, peers } = setup();
    const peer = { url: "https://mac.example", name: "Mac", secret: "s" };
    await peers.write([peer]);
    const info = { ...HELLO, name: "Mac", nodeId: "mac-id", publicKey: "k" };
    const node = await nodes.register(peerIdOf(peer), info, "dialled");
    expect(node).toMatchObject({ id: "mac-id", identified: true });
    await expect(nodes.register("mac-id", { ...info, nodeId: "other-id" }, "dialled")).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("a peer named only by its URL host takes the node's own name at the first hello; a chosen name stays", async () => {
    const { nodes, peers } = setup();
    const bare = { url: "http://127.0.0.1:4317", name: "127.0.0.1:4317", secret: "s" };
    const chosen = { url: "https://nas.example", name: "NAS", secret: "t" };
    await peers.write([bare, chosen]);
    await nodes.register(
      peerIdOf(bare),
      { ...HELLO, name: "Mac", nodeId: "mac-id", publicKey: "k" },
      "dialled",
    );
    await nodes.register(
      peerIdOf(chosen),
      { ...HELLO, name: "Host", nodeId: "nas-id", publicKey: "k2" },
      "dialled",
    );
    expect((await peers.read()).map((peer) => peer.name)).toEqual(["Mac", "NAS"]);
    const known = {
      url: "http://10.0.0.2:1",
      name: "10.0.0.2:1",
      secret: "u",
      nodeId: "box-id",
      publicKey: "k3",
    };
    await peers.write([known]);
    await nodes.register("box-id", { ...HELLO, name: "Box", nodeId: "box-id", publicKey: "k3" }, "dialled");
    expect((await peers.read()).map((peer) => peer.name)).toEqual(["Box"]);
  });

  it("self reports the identity and resetIdentity makes a new one and drops every peer", async () => {
    const { nodes } = setup();
    expect((await nodes.self()).nodeId).toBe("self1");
    expect(await nodes.sign("x")).toBe("sig:x");
    await nodes.resetIdentity();
    expect((await nodes.self()).nodeId).toBe("self2");
    expect(await nodes.list()).toEqual([]);
  });
});

describe("dedupe by nodeId (owner A)", () => {
  const ID = "mac-id";
  const info = { ...HELLO, name: "Mac", nodeId: ID, publicKey: "k" };
  const peer = { url: "https://mac.example", name: "Mac", secret: "s1" };

  it("glare: a device and a peers entry for one nodeId are one node with two links", async () => {
    const { nodes, peers } = setup();
    await peers.write([peer]);
    await nodes.register(peerIdOf(peer), info, "dialled");
    await nodes.register("m1", info, "accepted");
    const list = await nodes.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.links.map((link) => link.direction).sort()).toEqual(["accepted", "dialled"]);
  });

  it("hides a standby link beside a live one and shows it when it is alone", async () => {
    const { nodes, peers } = setup();
    await peers.write([peer]);
    await nodes.register(peerIdOf(peer), info, "dialled");
    await nodes.register("m1", info, "accepted");
    nodes.reportLink(ID, { state: "standby", message: null, since: 1 });
    expect((await nodes.list())[0]?.links.map((link) => link.state)).toEqual(["linked"]);
    nodes.markOffline(ID);
    nodes.reportLink(ID, { state: "standby", message: null, since: 1 });
    expect((await nodes.list())[0]?.links.map((link) => link.state)).toEqual(["unreachable", "standby"]);
  });

  it("status: the best link wins", async () => {
    const { nodes, peers } = setup();
    await peers.write([peer]);
    await nodes.register(peerIdOf(peer), info, "dialled");
    await nodes.register("m1", info, "accepted");
    nodes.markOffline(ID);
    nodes.reportLink(ID, { state: "linked", message: null, since: 2 });
    expect((await nodes.list())[0]?.status).toBe("online");
  });

  it("case (b): a second device for the same nodeId is revoked, the established one stays", async () => {
    const { nodes } = setup();
    devices.push({ id: "m2", name: "Again", kind: "node", createdAt: 2, lastSeenAt: 2, current: false });
    await nodes.register("m1", info, "accepted");
    clock += 1000;
    const node = await nodes.register("m2", info, "accepted");
    expect(node.id).toBe(ID);
    expect(devices.map((d) => d.id)).toEqual(["m1"]);
  });

  it("case (b) stale: a silent established link is replaced and its device revoked", async () => {
    const { nodes } = setup();
    devices.push({ id: "m2", name: "Again", kind: "node", createdAt: 2, lastSeenAt: 2, current: false });
    await nodes.register("m1", info, "accepted");
    clock += 15_001;
    await nodes.register("m2", info, "accepted");
    expect(devices.map((d) => d.id)).toEqual(["m2"]);
  });

  it("case (b) on peers.json: the new entry is deleted, the standby secret of glare stays", async () => {
    const { nodes, peers } = setup();
    const second = { url: "https://mac2.example", name: "Mac again", secret: "s2" };
    await peers.write([peer, second]);
    await nodes.register(peerIdOf(peer), info, "dialled");
    clock += 1000;
    await nodes.register(peerIdOf(second), info, "dialled");
    expect((await peers.read()).map((entry) => entry.secret)).toEqual(["s1"]);
  });

  it("hides a second peers entry for one nodeId", async () => {
    const { nodes, peers } = setup();
    await peers.write([
      { ...peer, nodeId: ID, publicKey: "k" },
      { url: "https://x", name: "Dup", secret: "s2", nodeId: ID, publicKey: "k" },
    ]);
    expect((await nodes.list()).filter((node) => node.id === ID)).toHaveLength(1);
  });

  it("moves the summary from the old id to the nodeId at the first hello", async () => {
    const { nodes } = setup();
    await nodes.register("m1", HELLO, "accepted");
    await nodes.writeSummary("m1", SUMMARY);
    await nodes.register("m1", info, "accepted");
    expect(await nodes.readSummary(ID)).toEqual(SUMMARY);
    expect(await nodes.readSummary("m1")).toBeUndefined();
  });

  it("disconnect and forget delete the peers entry and the device", async () => {
    const { nodes, peers } = setup();
    await peers.write([{ ...peer, nodeId: ID, publicKey: "k" }]);
    await nodes.register("m1", info, "accepted");
    await nodes.forget(ID);
    expect(await peers.read()).toEqual([]);
    expect(devices).toEqual([]);
  });
});

describe("standby retry timing", () => {
  it("dials once per minute and never beside a live link", () => {
    expect(standbyDialDue({ lastTriedAt: 0, liveLinkExists: false }, 59_999)).toBe(false);
    expect(standbyDialDue({ lastTriedAt: 0, liveLinkExists: false }, 60_000)).toBe(true);
    expect(standbyDialDue({ lastTriedAt: 0, liveLinkExists: true }, 600_000)).toBe(false);
  });
});

describe("resetIdentity (owner A)", () => {
  it("drops peers and devices and the identity is new at once", async () => {
    const { nodes, peers } = setup();
    await peers.write([{ url: "https://mac.example", name: "Mac", secret: "s" }]);
    await nodes.resetIdentity();
    expect(await peers.read()).toEqual([]);
    expect(devices).toEqual([]);
    expect((await nodes.self()).nodeId).toBe("self2");
  });
});
