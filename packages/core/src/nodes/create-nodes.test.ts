import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Change, Device } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChangeEmitter } from "../change-emitter";
import { createFakeRemoteAdapter } from "../remote/fake-adapter";
import { createRemoteService } from "../remote/remote-service";
import { createNodes } from "./create-nodes";

const HELLO = { name: "Homelab", os: "linux", tauVersion: "1", protocolVersion: "v1", threadCount: 1 };
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
  devices = [
    { id: "m1", name: "Homelab", kind: "machine", createdAt: 1, lastSeenAt: 1, current: false } as Device,
  ];
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
  };
  const nodes = createNodes({
    directory: join(dir, "machines"),
    now: () => clock,
    changes,
    access,
    protocolVersion: "v1",
  });
  return { nodes, changes, access };
}

describe("node status", () => {
  it("walks online, reconnecting, offline and back with a heartbeat", async () => {
    const { nodes } = setup();
    await nodes.register("m1", HELLO);
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
    await nodes.register("m1", HELLO);
    clock += 2000;
    nodes.markOffline("m1");
    expect((await nodes.list())[0]).toMatchObject({ status: "offline", lastSeenAt: 3000 });
  });

  it("a different protocol version is update-required until it goes silent", async () => {
    const { nodes } = setup();
    await nodes.register("m1", { ...HELLO, protocolVersion: "v0" });
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
    await nodes.register("m1", { ...HELLO, protocolVersion: "v0" });
    nodes.markOffline("m1");
    expect((await nodes.list())[0]?.status).toBe("update-required");
  });
});

describe("summary cache", () => {
  it("is private, atomic, healthy-only and marked stale on disconnect of the link", async () => {
    const { nodes } = setup();
    await nodes.register("m1", HELLO);
    await nodes.writeSummary("m1", { ...SUMMARY, extra: "no" } as typeof SUMMARY);
    const file = join(dir, "machines", "m1", "summary.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(SUMMARY);
    nodes.markOffline("m1");
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.parse(await readFile(file, "utf8")).stale).toBe(true);
    expect(await nodes.readSummary("m1")).toEqual(SUMMARY);
    await nodes.writeSummary("m1", { ...SUMMARY, savedAt: 9 });
    expect((await nodes.readSummary("m1"))?.savedAt).toBe(1);
  });

  it("is deleted on disconnect and announces", async () => {
    const { nodes } = setup();
    await nodes.register("m1", HELLO);
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
    await nodes.register("m1", HELLO);
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
