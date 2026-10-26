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

const ON = { main: "balanced", worktree: "balanced", subagent: "balanced" } as const;
const settings = (patch: Partial<ResourceSettings>): ResourceSettings => ({
  ...DEFAULT_RESOURCE_SETTINGS,
  levels: { ...ON },
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

const foreground = (
  service: ProcessService,
  command: string,
  callId: string,
  governed = true,
  scope: "main" | "worktree" | "subagent" = "main",
) =>
  service.runForeground({
    conversationId: "c1",
    callId,
    cwd,
    command,
    onOutput: () => {},
    ...(governed && { governed, scope }),
  });

async function _waitFor(check: () => boolean) {
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
  it("spawns today's argv, wraps nothing, emits nothing", async () => {
    const service = make(DEFAULT_RESOURCE_SETTINGS);
    const run = await foreground(service, "echo hi", "a");
    await run.admitted;
    await run.outcome;
    expect(spawnCalls).toEqual([{ file: "/bin/sh", args: ["-c", "echo hi"] }]);
    expect(service.resourceActivity()).toEqual({ holders: [], waiting: [] });
    expect(resourceChanges).toBe(0);
    await run.release(false);
  });

  it("an ungoverned command runs at full speed while other scopes are on", async () => {
    const service = make(settings({}));
    const run = await foreground(service, "echo hi", "a", false);
    await run.outcome;
    expect(spawnCalls).toEqual([{ file: "/bin/sh", args: ["-c", "echo hi"] }]);
    await run.release(false);
  });
});

describe("per-scope power", () => {
  const macSupport = (): ResourceSupportProbe => ({
    platform: "macos",
    binaries: () => ({ taskpolicy: "/usr/sbin/taskpolicy" }),
    prepareMemory: async () => ({ cgroupMemory: false }),
    describe: async () => ({
      platform: "macos",
      memoryEnforcement: "polled",
      prioritySupported: true,
      sameCgroupOnly: false,
      note: null,
    }),
    unitFor: (id) => `tau-x-${id}`,
    scopeVerdict: async () => undefined,
    stop: () => {},
  });

  it("wraps with the calling scope's level", async () => {
    const service = make(settings({ levels: { main: "background", worktree: "off", subagent: "off" } }), {
      support: macSupport(),
    });
    const run = await foreground(service, "echo hi", "a", true, "main");
    await run.outcome.catch(() => {});
    expect(spawnCalls[0]?.file).toBe("/usr/sbin/taskpolicy");
    expect(spawnCalls[0]?.args[0]).toBe("-b");
    await run.release(false);
  });

  it("an Off scope wraps nothing while another scope is on", async () => {
    const service = make(settings({ levels: { main: "off", worktree: "off", subagent: "balanced" } }), {
      support: macSupport(),
    });
    const run = await foreground(service, "echo hi", "a", true, "main");
    await run.outcome;
    expect(spawnCalls).toEqual([{ file: "/bin/sh", args: ["-c", "echo hi"] }]);
    await run.release(false);
  });

  it("forwards a non-main scope through runForeground", async () => {
    const service = make(settings({ levels: { main: "off", worktree: "off", subagent: "background" } }), {
      support: macSupport(),
    });
    const run = await foreground(service, "echo hi", "a", true, "subagent");
    await run.outcome.catch(() => {});
    expect(spawnCalls[0]?.file).toBe("/usr/sbin/taskpolicy");
    expect(spawnCalls[0]?.args[0]).toBe("-b");
    await run.release(false);
  });

  it("stopResourceCommand always rejects: there is no queue", async () => {
    const service = make(settings({}));
    await expect(service.stopResourceCommand("nope")).rejects.toThrow();
    const run = await foreground(service, "echo hi; sleep 5", "a");
    await expect(service.stopResourceCommand(run.id)).rejects.toThrow();
    await run.stop();
    await run.outcome;
  });

  it("a spawn failure rejects the outcome", async () => {
    const service = make(settings({}), {
      spawn: (() => {
        throw new Error("spawn exploded");
      }) as unknown as SpawnFn,
    });
    const run = await foreground(service, "echo hi", "a");
    await expect(run.outcome).rejects.toThrow("spawn exploded");
    await run.admitted;
    expect(service.resourceActivity()).toEqual({ holders: [], waiting: [] });
  });

  it("a prepare failure rejects the outcome", async () => {
    const service = make(settings({}), {
      prepare: async () => {
        throw new Error("no disk");
      },
    });
    const run = await foreground(service, "echo hi", "a");
    await expect(run.outcome).rejects.toThrow("no disk");
  });

  it("stop during a slow prepare never spawns", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = make(settings({}), { prepare: () => gate });
    const run = await foreground(service, "echo hi", "a");
    await run.stop("user");
    release();
    await run.admitted;
    expect(spawnCalls).toHaveLength(0);
    expect(service.resourceActivity().holders).toEqual([]);
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
          failure: "Resource limits unavailable: no bus. Fix or turn them off in Settings → Agent.",
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
    const service = make(settings({}), { support: failingSupport() });
    const first = await foreground(service, "echo one", "a");
    await expect(first.outcome).rejects.toThrow("Resource limits unavailable");
    const second = await foreground(service, "echo two", "b");
    expect((await second.outcome).kind).toBe("exited");
    expect(spawnCalls).toHaveLength(1);
    await second.release(false);
  });
});
