import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RESOURCE_SETTINGS, type ResourceSettings } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createResourceState } from "./governor/resource-state";
import type { ResourceSupportProbe } from "./governor/resource-support";
import { sleep } from "./process-group";
import { createProcessService, type ProcessService } from "./process-service";
import type { SpawnFn } from "./running-process";

let home: string;
let cwd: string;
let resourceChanges: number;
let spawnCalls: Array<{ file: string; args: readonly string[] }>;
const services: ProcessService[] = [];

const settings = (patch: Partial<ResourceSettings>): ResourceSettings => ({
  ...DEFAULT_RESOURCE_SETTINGS,
  ...patch,
});
const recordingSpawn: SpawnFn = ((file: string, args: string[], options: never) => {
  spawnCalls.push({ file, args });
  return spawn(file, args, options);
}) as SpawnFn;

function make(initial: ResourceSettings, extra: Partial<Parameters<typeof createProcessService>[0]> = {}) {
  const resources = createResourceState(initial);
  const service = createProcessService({
    home,
    emitChange: () => {},
    emitResourcesChange: () => resourceChanges++,
    stopGraceMs: 300,
    resources,
    spawn: recordingSpawn,
    ...extra,
  });
  services.push(service);
  return service;
}

const foreground = (service: ProcessService, command: string, callId: string, governed = true) =>
  service.runForeground({
    conversationId: "c1",
    callId,
    cwd,
    command,
    onOutput: () => {},
    ...(governed && { governed }),
  });

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 300 && !check(); attempt++) await sleep(50);
  expect(check()).toBe(true);
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-gov-home-"));
  cwd = await mkdtemp(join(tmpdir(), "pi-gov-cwd-"));
  resourceChanges = 0;
  spawnCalls = [];
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAll()));
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe("Off path", () => {
  it("spawns today's argv, takes no slot, emits nothing", async () => {
    const service = make(DEFAULT_RESOURCE_SETTINGS);
    const run = await foreground(service, "echo hi", "a");
    await run.admitted;
    await run.outcome;
    expect(spawnCalls).toEqual([{ file: "/bin/sh", args: ["-c", "echo hi"] }]);
    expect(service.resourceActivity()).toEqual({ holders: [], waiting: [] });
    expect(resourceChanges).toBe(0);
    await run.release(false);
  });

  it("an ungoverned command ignores heavy slots", async () => {
    const service = make(settings({ heavySlots: 1 }));
    const run = await foreground(service, "pnpm test --help >/dev/null 2>&1; true", "a", false);
    expect(spawnCalls).toHaveLength(1);
    await run.outcome;
    await run.release(false);
  });
});

describe("heavy slots", () => {
  it("queues the second heavy command until the first exits", async () => {
    const service = make(settings({ heavySlots: 1 }));
    const first = await foreground(service, "cargo test --version 2>/dev/null; sleep 1", "a");
    const second = await foreground(service, "cargo test --version 2>/dev/null; true", "b");
    expect(service.resourceActivity().waiting).toHaveLength(1);
    expect(spawnCalls).toHaveLength(1);
    await first.outcome;
    await second.admitted;
    await second.outcome;
    expect(spawnCalls).toHaveLength(2);
    await first.release(false);
    await second.release(false);
    expect(resourceChanges).toBeGreaterThan(0);
  });

  it("stopping a queued command cancels it without spawning", async () => {
    const service = make(settings({ heavySlots: 1 }));
    const first = await foreground(service, "cargo test --x 2>/dev/null; sleep 2", "a");
    const second = await foreground(service, "cargo test --y 2>/dev/null; true", "b");
    await second.stop("resources");
    expect(await second.outcome).toEqual({
      kind: "exited",
      exitCode: null,
      stopRequested: true,
      stopReason: "resources",
    });
    await second.stop("user");
    expect(spawnCalls).toHaveLength(1);
    await first.stop();
    await first.outcome;
    expect(service.resourceActivity()).toEqual({ holders: [], waiting: [] });
  });

  it("stopResourceCommand only accepts listed ids", async () => {
    const service = make(settings({ heavySlots: 1 }));
    await expect(service.stopResourceCommand("nope")).rejects.toThrow();
    const run = await foreground(service, "cargo test --z 2>/dev/null; sleep 5", "a");
    await service.stopResourceCommand(run.id);
    expect((await run.outcome).kind).toBe("exited");
  });

  it("a queued call can be moved to the background and counts as running", async () => {
    const service = make(settings({ heavySlots: 1 }));
    const first = await foreground(service, "cargo test --a 2>/dev/null; sleep 1", "a");
    const second = await foreground(service, "cargo test --b 2>/dev/null; true", "b");
    const info = await service.background("c1", "b");
    expect(info.state).toBe("queued");
    expect(service.hasRunning("c1")).toBe(true);
    await first.outcome;
    await waitFor(() => spawnCalls.length === 2);
    expect((await second.outcome).kind).toBe("background");
  });

  it("a spawn failure rejects the outcome and frees the slot", async () => {
    const service = make(settings({ heavySlots: 1 }), {
      spawn: (() => {
        throw new Error("spawn exploded");
      }) as unknown as SpawnFn,
    });
    const run = await foreground(service, "cargo test --c 2>/dev/null", "a");
    await expect(run.outcome).rejects.toThrow("spawn exploded");
    await run.admitted;
    expect(service.resourceActivity()).toEqual({ holders: [], waiting: [] });
  });

  it("a prepare failure rejects and frees the slot", async () => {
    const service = make(settings({ heavySlots: 1 }), {
      prepare: async () => {
        throw new Error("no disk");
      },
    });
    const run = await foreground(service, "cargo test --d 2>/dev/null", "a");
    await expect(run.outcome).rejects.toThrow("no disk");
    expect(service.resourceActivity().holders).toEqual([]);
  });

  it("stop during a slow prepare never spawns and releases the slot", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = make(settings({ heavySlots: 1 }), { prepare: () => gate });
    const run = await foreground(service, "cargo test --e 2>/dev/null", "a");
    await run.stop("user");
    release();
    await run.admitted;
    expect(spawnCalls).toHaveLength(0);
    expect(service.resourceActivity().holders).toEqual([]);
  });

  it("raising the limit drains waiters", async () => {
    const service = make(settings({ heavySlots: 1 }));
    const first = await foreground(service, "cargo test --f 2>/dev/null; sleep 2", "a");
    const second = await foreground(service, "cargo test --g 2>/dev/null; true", "b");
    service.setResources(settings({ heavySlots: null }));
    await second.admitted;
    await waitFor(() => spawnCalls.length === 2);
    await first.stop();
  });
});

describe("memory limit probe", () => {
  const failingSupport = (): ResourceSupportProbe => ({
    platform: "linux",
    binaries: () => ({ sh: "/bin/sh" }),
    prepareMemory: (() => {
      let first = true;
      return async () => {
        if (!first) return { cgroupMemory: false };
        first = false;
        return {
          cgroupMemory: false,
          failure: "Resource limits unavailable: no bus. Fix or turn them off in Settings → Resources.",
        };
      };
    })(),
    describe: async () => ({
      platform: "linux",
      memoryEnforcement: "polled",
      prioritySupported: true,
      sameCgroupOnly: true,
      note: null,
    }),
    unitFor: (id) => `tau-x-${id}`,
    scopeVerdict: async () => undefined,
    stop: () => {},
  });

  it("fails exactly one command on the degraded transition, then uses the basic wrapper", async () => {
    const service = make(settings({ memoryLimitMb: 512 }), { support: failingSupport() });
    const first = await foreground(service, "echo one", "a");
    await expect(first.outcome).rejects.toThrow("Resource limits unavailable");
    const second = await foreground(service, "echo two", "b");
    expect((await second.outcome).kind).toBe("exited");
    expect(spawnCalls).toHaveLength(1);
    await second.release(false);
  });
});
