import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Change, Device } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChangeEmitter } from "../change-emitter";
import { createFakeRemoteAdapter } from "../remote/fake-adapter";
import { createRemoteService } from "../remote/remote-service";
import { createMachines } from "./create-machines";

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
  dir = await mkdtemp(join(tmpdir(), "tau-machines-"));
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
  const machines = createMachines({
    directory: join(dir, "machines"),
    now: () => clock,
    changes,
    access,
    protocolVersion: "v1",
  });
  return { machines, changes, access };
}

describe("machine status", () => {
  it("walks online, reconnecting, offline and back with a heartbeat", async () => {
    const { machines } = setup();
    await machines.register("m1", HELLO);
    const status = async () => (await machines.list())[0]?.status;
    expect(await status()).toBe("online");
    clock += 14_999;
    expect(await status()).toBe("online");
    clock += 1;
    expect(await status()).toBe("reconnecting");
    clock += 30_000;
    expect(await status()).toBe("offline");
    machines.heartbeat("m1", 4);
    expect(await status()).toBe("online");
  });

  it("markOffline is immediate and keeps lastSeenAt", async () => {
    const { machines } = setup();
    await machines.register("m1", HELLO);
    clock += 2000;
    machines.markOffline("m1");
    expect((await machines.list())[0]).toMatchObject({ status: "offline", lastSeenAt: 3000 });
  });

  it("a different protocol version is update-required until it goes silent", async () => {
    const { machines } = setup();
    await machines.register("m1", { ...HELLO, protocolVersion: "v0" });
    expect((await machines.list())[0]?.status).toBe("update-required");
    await machines.writeSummary("m1", SUMMARY);
    expect(await machines.readSummary("m1")).toBeUndefined();
    clock += 45_000;
    expect((await machines.list())[0]?.status).toBe("offline");
  });
});

describe("summary cache", () => {
  it("is private, atomic, healthy-only and marked stale on disconnect of the link", async () => {
    const { machines } = setup();
    await machines.register("m1", HELLO);
    await machines.writeSummary("m1", { ...SUMMARY, extra: "no" } as typeof SUMMARY);
    const file = join(dir, "machines", "m1", "summary.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(SUMMARY);
    machines.markOffline("m1");
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.parse(await readFile(file, "utf8")).stale).toBe(true);
    expect(await machines.readSummary("m1")).toEqual(SUMMARY);
    await machines.writeSummary("m1", { ...SUMMARY, savedAt: 9 });
    expect((await machines.readSummary("m1"))?.savedAt).toBe(1);
  });

  it("is deleted on disconnect and announces", async () => {
    const { machines } = setup();
    await machines.register("m1", HELLO);
    await machines.writeSummary("m1", SUMMARY);
    seen.length = 0;
    await machines.disconnect("m1");
    expect(await machines.readSummary("m1")).toBeUndefined();
    expect(await machines.list()).toEqual([]);
    expect(seen).toContainEqual({ resource: "machines" });
  });

  it("is deleted when remote is disabled or recreated", async () => {
    const { machines, changes } = setup();
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
      forgetMachines: () => machines.reset(),
    });
    await machines.register("m1", HELLO);
    await machines.writeSummary("m1", SUMMARY);
    await service.api.enable();
    seen.length = 0;
    await service.api.disable();
    expect(await machines.readSummary("m1")).toBeUndefined();
    expect(await machines.list()).toEqual([]);
    expect(seen).toContainEqual({ resource: "machines" });
  });
});
