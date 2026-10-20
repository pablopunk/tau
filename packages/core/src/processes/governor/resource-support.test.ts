import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Exec, ExecResult } from "./exec";
import {
  createResourceSupport,
  FIRST_PROBE_SCRIPT,
  PROBE_TIMEOUT_MS,
  priorityIsCgroupLimited,
} from "./resource-support";

const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "", timedOut: false });
const fail = (stderr: string): ExecResult => ({ code: 1, stdout: "", stderr, timedOut: false });
const BINS = { systemdRun: "/usr/bin/systemd-run", sh: "/bin/sh", nice: "/usr/bin/nice" };
const MAX = String(64 * 1024 * 1024);

function recorder(answer: (args: readonly string[]) => Promise<ExecResult> | ExecResult) {
  const calls: { file: string; args: readonly string[]; timeoutMs?: number }[] = [];
  const exec: Exec = async (file, args, options) => {
    calls.push({ file, args, ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
    return answer(args);
  };
  return { calls, exec };
}

const supportWith = (exec: Exec, env: NodeJS.ProcessEnv = {}) =>
  createResourceSupport({
    nodeId: () => "node-a",
    exec,
    platform: "linux",
    env,
    binaries: BINS,
    sleep: async () => {},
  });
const probes = (calls: { args: readonly string[]; timeoutMs?: number }[]) =>
  calls.filter((call) => call.args.some((arg) => arg.startsWith("--unit=tau-probe-")));

describe("probe script", () => {
  it("uses shell builtins only, so a minimal PATH cannot break it", () => {
    expect(FIRST_PROBE_SCRIPT).not.toMatch(/\b(cat|cut|awk|sed)\b/);
  });

  it("reads memory.max of the scope's own cgroup, with an empty PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-"));
    mkdirSync(join(dir, "user.slice/x.scope"), { recursive: true });
    writeFileSync(join(dir, "cgroup"), "0::/user.slice/x.scope\n");
    writeFileSync(join(dir, "user.slice/x.scope/memory.max"), `${MAX}\n`);
    const script = FIRST_PROBE_SCRIPT.replace("/proc/self/cgroup", join(dir, "cgroup")).replace(
      "/sys/fs/cgroup${line#0::}",
      `${dir}\${line#0::}`,
    );
    const run = spawnSync("/bin/sh", ["-c", script], { encoding: "utf8", env: { PATH: "/nonexistent" } });
    rmSync(dir, { recursive: true });
    expect(run.stdout.trim()).toBe(MAX);
  });
});

describe("prepareMemory", () => {
  it("shares one probe between concurrent spawns", async () => {
    const { calls, exec } = recorder(async (args) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return args.includes("--collect") ? ok(MAX) : ok();
    });
    const support = supportWith(exec);
    const all = await Promise.all([1, 2, 3, 4].map(() => support.prepareMemory()));
    expect(all.every((entry) => entry.cgroupMemory && entry.failure === undefined)).toBe(true);
    expect(probes(calls)).toHaveLength(1);
    expect(probes(calls)[0]?.timeoutMs).toBe(PROBE_TIMEOUT_MS);
  });

  it("probe unit names use only safe characters and never repeat", async () => {
    const { calls, exec } = recorder(() => ok(MAX));
    const now = { value: 0 };
    const support = createResourceSupport({
      nodeId: () => "node-a",
      exec,
      platform: "linux",
      binaries: BINS,
      env: {},
      now: () => now.value,
    });
    await support.prepareMemory();
    now.value += 10_000;
    await support.prepareMemory();
    const units = probes(calls).map((call) => call.args.find((arg) => arg.startsWith("--unit="))?.slice(7));
    expect(new Set(units).size).toBe(2);
    for (const unit of units) expect(unit).toMatch(/^[a-zA-Z0-9:_.-]+$/);
  });

  it("fails exactly one of several concurrent spawns when the probe fails", async () => {
    const { exec } = recorder(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return fail("Failed to connect to bus\nmore");
    });
    const support = supportWith(exec);
    const all = await Promise.all([1, 2, 3].map(() => support.prepareMemory()));
    expect(all.filter((entry) => entry.failure !== undefined)).toHaveLength(1);
    expect(all.find((entry) => entry.failure)?.failure).toContain(
      "Resource limits unavailable: Failed to connect to bus.",
    );
    expect(all.every((entry) => !entry.cgroupMemory)).toBe(true);
    expect((await support.prepareMemory()).failure).toBeUndefined();
  });

  it("retries a timed out probe once", async () => {
    const { calls, exec } = recorder(() => ({ code: null, stdout: "", stderr: "", timedOut: true }));
    const result = await supportWith(exec).prepareMemory();
    expect(probes(calls)).toHaveLength(2);
    expect(result.failure).toContain("timed out");
  });

  it("fills in the bus variables when tau's environment lacks them", async () => {
    const seen: (NodeJS.ProcessEnv | undefined)[] = [];
    const exec: Exec = async (_file, _args, options) => {
      seen.push(options?.env);
      return ok(MAX);
    };
    await supportWith(exec, {}).prepareMemory();
    expect(seen[0]?.XDG_RUNTIME_DIR).toMatch(/^\/run\/user\/\d+$/);
    expect(seen[0]?.DBUS_SESSION_BUS_ADDRESS).toMatch(/^unix:path=\/run\/user\/\d+\/bus$/);
  });
});

describe("priorityIsCgroupLimited", () => {
  const line = (path: string) => `0::${path}\n`;
  it("is false in a session or terminal scope", () => {
    expect(priorityIsCgroupLimited(line("/user.slice/user-1000.slice/session-187.scope"))).toBe(false);
    expect(
      priorityIsCgroupLimited(
        line("/user.slice/user-1000.slice/user@1000.service/app.slice/app-vte-spawn-1.scope"),
      ),
    ).toBe(false);
  });

  it("is true in a systemd service", () => {
    expect(
      priorityIsCgroupLimited(line("/user.slice/user-1000.slice/user@1000.service/app.slice/tau.service")),
    ).toBe(true);
    expect(priorityIsCgroupLimited(line("/system.slice/tau.service"))).toBe(true);
  });

  it("is true when the cgroup is unknown", () => {
    expect(priorityIsCgroupLimited(undefined)).toBe(true);
    expect(priorityIsCgroupLimited("")).toBe(true);
    expect(priorityIsCgroupLimited("12:cpu:/user\n")).toBe(true);
    expect(priorityIsCgroupLimited(line("/"))).toBe(true);
  });
});

describe("describe", () => {
  const described = (cgroup: string) =>
    createResourceSupport({
      nodeId: () => "node-a",
      exec: async () => ok(MAX),
      platform: "linux",
      binaries: BINS,
      env: {},
      selfCgroup: () => cgroup,
    }).describe();

  it("reports the same-cgroup limit only for a service", async () => {
    expect((await described("0::/user.slice/user-1000.slice/session-3.scope\n")).sameCgroupOnly).toBe(false);
    expect(
      (await described("0::/user.slice/user-1000.slice/user@1000.service/app.slice/tau.service\n"))
        .sameCgroupOnly,
    ).toBe(true);
  });
});
