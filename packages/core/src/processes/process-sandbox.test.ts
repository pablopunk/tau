import { EventEmitter } from "node:events";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxSettings } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Exec } from "./governor/exec";
import { createProcessService, type ProcessService } from "./process-service";
import type { SpawnFn } from "./running-process";

const ON: SandboxSettings = { main: true, worktree: true, subagent: true };

let home: string;
let cwd: string;
const services: ProcessService[] = [];
const spawnCalls: Array<{ file: string; args: readonly string[] }> = [];
const execCalls: Array<{ file: string; args: readonly string[] }> = [];

class HangingChild extends EventEmitter {
  readonly pid = 999983;
  readonly stdout = undefined;
  readonly stderr = undefined;
}

const hangingSpawn = ((file: string, args: string[]) => {
  spawnCalls.push({ file, args });
  return new HangingChild();
}) as unknown as SpawnFn;

const fakeExec = (async (file: string, args: readonly string[]) => {
  execCalls.push({ file, args });
  return { code: 0, stdout: "", stderr: "", timedOut: false };
}) as Exec;

const NODE_ID = "test-node";

function make(extra: Partial<Parameters<typeof createProcessService>[0]> = {}) {
  const service = createProcessService({
    home,
    emitChange: () => {},
    stopGraceMs: 50,
    nodeId: () => NODE_ID,
    ...extra,
  });
  services.push(service);
  return service;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-sandbox-home-"));
  cwd = await mkdtemp(join(tmpdir(), "pi-sandbox-cwd-"));
  spawnCalls.length = 0;
  execCalls.length = 0;
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAll()));
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe("sandbox spawn integration", () => {
  it("wraps the shell OUTSIDE with the seatbelt prefix when on", async () => {
    const service = make({
      spawn: hangingSpawn,
      sandbox: ON,
      sandboxPlatform: "macos",
      sandboxBinaries: { sandboxExec: "/usr/bin/sandbox-exec" },
    });
    const info = await service.start({
      conversationId: "c1",
      cwd,
      command: "echo hi",
      scope: "worktree",
      sandboxRoot: cwd,
    });
    expect(info.state).toBe("running");
    expect(spawnCalls).toHaveLength(1);
    const [call] = spawnCalls;
    expect(call?.file).toBe("/usr/bin/sandbox-exec");
    // Sandbox outside: seatbelt prefix first, then the plain shell tail (governor off here).
    expect(call?.args[0]).toBe("-p");
    expect(call?.args[1]).toContain(`(subpath "${realpathSync(cwd)}")`);
    expect(call?.args.slice(-3)).toEqual(["/bin/sh", "-c", "echo hi"]);
  });

  it("nests the sandbox outside the inner command on the systemd path", async () => {
    const service = make({
      spawn: hangingSpawn,
      sandbox: ON,
      sandboxPlatform: "linux",
      sandboxBinaries: { systemdRun: "/usr/bin/systemd-run" },
    });
    const info = await service.start({
      conversationId: "c1",
      cwd,
      command: "echo hi",
      scope: "worktree",
      sandboxRoot: cwd,
    });
    const [call] = spawnCalls;
    expect(call?.file).toBe("/usr/bin/systemd-run");
    const args = [...(call?.args ?? [])];
    const separator = args.indexOf("--");
    expect(separator).toBeGreaterThan(0);
    expect(args.some((arg) => arg.startsWith("--unit=tau-"))).toBe(true);
    expect(args.slice(0, separator)).toContain(`--working-directory=${cwd}`);
    // The inner command (governor wrap or plain shell) rides AFTER the separator.
    expect(args.slice(separator + 1).slice(-3)).toEqual(["/bin/sh", "-c", "echo hi"]);
    await service.stop(info.id);
  });

  it("passes through today's argv when the switch is off", async () => {
    const service = make({ spawn: hangingSpawn });
    await service.start({ conversationId: "c1", cwd, command: "echo hi", sandboxRoot: cwd });
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.file).toBe("/bin/sh");
    expect(spawnCalls[0]?.args).toEqual(["-c", "echo hi"]);
  });

  it("denies fail-closed without a trusted root", async () => {
    const service = make({
      spawn: hangingSpawn,
      sandbox: ON,
      sandboxPlatform: "macos",
      sandboxBinaries: { sandboxExec: "/usr/bin/sandbox-exec" },
    });
    await expect(
      service.start({ conversationId: "c1", cwd, command: "echo hi", scope: "worktree" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(spawnCalls).toHaveLength(0);
  });

  it("denies when the cwd escapes the trusted root: never substitutes cwd", async () => {
    const service = make({
      spawn: hangingSpawn,
      sandbox: ON,
      sandboxPlatform: "macos",
      sandboxBinaries: { sandboxExec: "/usr/bin/sandbox-exec" },
    });
    const other = await mkdtemp(join(tmpdir(), "pi-sandbox-other-"));
    try {
      await expect(
        service.start({
          conversationId: "c1",
          cwd: other,
          command: "echo hi",
          scope: "worktree",
          sandboxRoot: cwd,
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(spawnCalls).toHaveLength(0);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("denies instead of running unenforced when the host has no path", async () => {
    const service = make({
      spawn: hangingSpawn,
      sandbox: ON,
      sandboxPlatform: "other",
      sandboxBinaries: {},
    });
    await expect(
      service.start({ conversationId: "c1", cwd, command: "echo hi", sandboxRoot: cwd }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(spawnCalls).toHaveLength(0);
  });

  it("resolves the root from trusted thread metadata when the request carries none", async () => {
    const service = make({
      spawn: hangingSpawn,
      sandbox: ON,
      sandboxPlatform: "macos",
      sandboxBinaries: { sandboxExec: "/usr/bin/sandbox-exec" },
      resolveSandboxRoot: () => ({ kind: "worktree" as const, root: cwd }),
    });
    await service.start({ conversationId: "c1", cwd, command: "echo hi", scope: "subagent" });
    expect(spawnCalls[0]?.file).toBe("/usr/bin/sandbox-exec");
  });

  it("forwards the trusted root for foreground runs", async () => {
    const service = make({
      spawn: hangingSpawn,
      sandbox: ON,
      sandboxPlatform: "macos",
      sandboxBinaries: { sandboxExec: "/usr/bin/sandbox-exec" },
    });
    const run = await service.runForeground({
      conversationId: "c1",
      callId: "call-1",
      cwd,
      command: "echo hi",
      scope: "worktree",
      sandboxRoot: cwd,
      onOutput: () => {},
    });
    // The spawn attempt runs in the background once launch returns.
    await run.admitted;
    expect(spawnCalls[0]?.file).toBe("/usr/bin/sandbox-exec");
    await run.stop("user");
    await run.outcome;
    await run.release(false);
  });
});

describe("sandbox scope is independent of resource eligibility", () => {
  const WORKTREE_ONLY: SandboxSettings = { main: false, worktree: true, subagent: true };
  const macSandbox = {
    spawn: hangingSpawn,
    sandboxPlatform: "macos" as const,
    sandboxBinaries: { sandboxExec: "/usr/bin/sandbox-exec" },
    resolveSandboxRoot: () => ({ kind: "worktree" as const, root: cwd }),
  };

  it("sandboxes a worktree thread by its own switch although main is off and it is ungoverned", async () => {
    const service = make({ ...macSandbox, sandbox: WORKTREE_ONLY });
    await service.start({ conversationId: "c1", cwd, command: "echo hi", sandboxScope: "worktree" });
    expect(spawnCalls[0]?.file).toBe("/usr/bin/sandbox-exec");
  });

  it("sandboxes a subagent thread by its own switch although main is off", async () => {
    const service = make({ ...macSandbox, sandbox: WORKTREE_ONLY });
    await service.start({ conversationId: "c1", cwd, command: "echo hi", sandboxScope: "subagent" });
    expect(spawnCalls[0]?.file).toBe("/usr/bin/sandbox-exec");
  });

  it("leaves a main thread alone when only worktree and subagent are on", async () => {
    const service = make({ ...macSandbox, sandbox: WORKTREE_ONLY });
    await service.start({ conversationId: "c1", cwd, command: "echo hi", sandboxScope: "main" });
    expect(spawnCalls[0]?.file).toBe("/bin/sh");
  });

  it("leaves a worktree thread alone when its switch is off although main is on", async () => {
    const service = make({ ...macSandbox, sandbox: { main: true, worktree: false, subagent: false } });
    await service.start({ conversationId: "c1", cwd, command: "echo hi", sandboxScope: "worktree" });
    expect(spawnCalls[0]?.file).toBe("/bin/sh");
  });

  it("prefers the sandbox scope over the governor scope", async () => {
    const service = make({ ...macSandbox, sandbox: WORKTREE_ONLY });
    await service.start({
      conversationId: "c1",
      cwd,
      command: "echo hi",
      governed: true,
      scope: "main",
      sandboxScope: "worktree",
    });
    expect(spawnCalls[0]?.file).toBe("/usr/bin/sandbox-exec");
  });

  it("denies an unresolved thread fail-closed when any scope is on, without a trusted root", async () => {
    const service = make({ ...macSandbox, sandbox: WORKTREE_ONLY, resolveSandboxRoot: () => undefined });
    await expect(
      service.start({ conversationId: "c1", cwd, command: "echo hi", sandboxScope: "unknown" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(spawnCalls).toHaveLength(0);
  });

  it("sandboxes an unresolved thread when its root still resolves", async () => {
    const service = make({ ...macSandbox, sandbox: WORKTREE_ONLY });
    await service.start({ conversationId: "c1", cwd, command: "echo hi", sandboxScope: "unknown" });
    expect(spawnCalls[0]?.file).toBe("/usr/bin/sandbox-exec");
  });

  it("runs an unresolved thread plainly while every scope is off", async () => {
    const service = make({ ...macSandbox });
    await service.start({ conversationId: "c1", cwd, command: "echo hi", sandboxScope: "unknown" });
    expect(spawnCalls[0]?.file).toBe("/bin/sh");
  });

  it("forwards the sandbox scope for foreground runs", async () => {
    const service = make({ ...macSandbox, sandbox: WORKTREE_ONLY });
    const run = await service.runForeground({
      conversationId: "c1",
      callId: "call-1",
      cwd,
      command: "echo hi",
      sandboxScope: "worktree",
      onOutput: () => {},
    });
    await run.admitted;
    expect(spawnCalls[0]?.file).toBe("/usr/bin/sandbox-exec");
    await run.stop("user");
    await run.outcome;
    await run.release(false);
  });
});

describe("sandbox unit lifecycle", () => {
  it("persists a stable unit id and stops/kills the UNIT explicitly", async () => {
    const service = make({
      spawn: hangingSpawn,
      exec: fakeExec,
      sandbox: ON,
      sandboxPlatform: "linux",
      sandboxBinaries: { systemdRun: "/usr/bin/systemd-run" },
    });
    const info = await service.start({
      conversationId: "c1",
      cwd,
      command: "sleep 60",
      scope: "worktree",
      sandboxRoot: cwd,
    });
    const unitArg = spawnCalls[0]?.args.find((arg) => arg.startsWith("--unit="));
    expect(unitArg).toMatch(new RegExp(`^--unit=tau-[0-9a-f]{12}-${info.id}\\.service$`));
    const unit = (unitArg as string).slice("--unit=".length);

    await service.stop(info.id);
    const stops = execCalls.filter((call) => call.args.includes("stop"));
    const kills = execCalls.filter((call) => call.args.includes("kill"));
    expect(stops).toHaveLength(1);
    expect(stops[0]?.args).toContain(unit);
    // The hanging child never reaps: the force path kills the unit with SIGKILL.
    expect(kills).toHaveLength(1);
    expect(kills[0]?.args).toContain("--signal=SIGKILL");
    expect(kills[0]?.args).toContain(unit);
  });

  it("reaps stale units on restart from the stable id", async () => {
    const first = make({
      spawn: hangingSpawn,
      exec: fakeExec,
      sandbox: ON,
      sandboxPlatform: "linux",
      sandboxBinaries: { systemdRun: "/usr/bin/systemd-run" },
    });
    const info = await first.start({
      conversationId: "c1",
      cwd,
      command: "sleep 60",
      scope: "worktree",
      sandboxRoot: cwd,
    });
    execCalls.length = 0;
    const second = make({
      exec: fakeExec,
      sandbox: ON,
      sandboxPlatform: "linux",
      sandboxBinaries: { systemdRun: "/usr/bin/systemd-run" },
    });
    await second.reapStaleAtStartup();
    const stops = execCalls.filter((call) => call.args.includes("stop"));
    expect(stops).toHaveLength(1);
    expect(stops[0]?.args.join(" ")).toContain(info.id);
    expect(await second.list("c1")).toEqual([]);
  });
});
