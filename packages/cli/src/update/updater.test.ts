import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServiceManager } from "../service/manager";
import type { CommandResult, DetachedOptions, Runner, RunOptions } from "../service/runner";
import { CLI, createTestNode } from "../service/test-context";
import { jobFileOf, readJobFile, writeJobFile } from "./job-file";
import { createUpdater, type JobFile, type UpdaterDeps } from "./updater";

const ROOT = "/h/.local/share/tau";

interface Seen {
  runs: { command: string; args: readonly string[]; options: RunOptions | undefined }[];
  detached: { command: string; args: readonly string[]; options: DetachedOptions | undefined }[];
}

function recordingRunner(respond: (line: string) => Partial<CommandResult> | undefined = () => undefined) {
  const seen: Seen = { runs: [], detached: [] };
  const runner: Runner = {
    async run(command, args, options) {
      seen.runs.push({ command, args, options });
      return { code: 0, stdout: "", stderr: "", ...respond([command, ...args].join(" ")) };
    },
    async spawnDetached(command, args, options) {
      seen.detached.push({ command, args, options });
      return 4242;
    },
  };
  return { runner, seen };
}

interface Options {
  /** `null`: a dev checkout. */
  installRoot?: string | null;
  platformKey?: string | null;
  platform?: NodeJS.Platform;
  installService?: boolean;
  respond?: (line: string) => Partial<CommandResult> | undefined;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  alive?: (pid: number) => boolean;
  version?: string;
  foreground?: boolean;
}

async function setup(options: Options = {}) {
  const { runner, seen } = recordingRunner(options.respond);
  const node = createTestNode({ runner, platform: options.platform ?? "darwin" });
  const home = node.tauHome;
  if (options.installService) await createServiceManager(node.context, CLI, home).install();
  seen.runs.length = 0;
  const deps: UpdaterDeps = {
    home,
    version: options.version ?? "1.0.0",
    context: node.context,
    cli: CLI,
    installRoot: options.installRoot === null ? undefined : (options.installRoot ?? ROOT),
    platformKey: options.platformKey === null ? undefined : (options.platformKey ?? "darwin-arm64"),
    env: options.env ?? { PATH: "/usr/bin", TAU_THREAD_ID: "t1", HOME: "/h" },
    now: options.now ?? (() => 1_000_000),
    foreground: options.foreground,
    newNonce: () => "nonce-1",
    isAlive: options.alive ?? ((pid) => pid === 4242),
  };
  return { updater: await createUpdater(deps), deps, seen, home, node };
}

describe("updater.plan", () => {
  it("runs on the detached backend (no service installed)", async () => {
    const { updater } = await setup();
    expect(updater.plan("1.1.0")).toEqual({ mode: "run", command: null, reason: null });
  });

  it("tells a foreground run it will not restart, and stays quiet for a service run", async () => {
    const reason =
      "tau was not started as a service, so it will not restart. Restart it yourself afterwards.";
    const { updater } = await setup({ foreground: true });
    expect(updater.plan("1.1.0")).toEqual({ mode: "run", command: null, reason });
    expect((await setup({ foreground: false })).updater.plan("1.1.0").reason).toBeNull();
  });

  it("runs on a verified launchd service", async () => {
    const { updater } = await setup({ installService: true });
    expect(updater.plan("1.1.0").mode).toBe("run");
  });

  it("is manual on systemd older than 236 (no --collect)", async () => {
    const { updater } = await setup({
      platform: "linux",
      installService: true,
      respond: (line) => (line === "systemctl --version" ? { stdout: "systemd 235 (235)\n" } : undefined),
    });
    expect(updater.plan("1.1.0").mode).toBe("manual");
  });

  it("runs on a verified systemd service and probes systemctl once", async () => {
    const { updater, seen } = await setup({
      platform: "linux",
      installService: true,
      respond: (line) => (line === "systemctl --version" ? { stdout: "systemd 255 (255)\n" } : undefined),
    });
    expect(updater.plan("1.1.0").mode).toBe("run");
    updater.plan("1.1.0");
    expect(seen.runs.filter((r) => r.command === "systemctl" && r.args[0] === "--version")).toHaveLength(1);
  });

  it("is none in a dev checkout", async () => {
    const { updater } = await setup({ installRoot: null });
    expect(updater.plan("1.1.0")).toMatchObject({ mode: "none", command: null });
  });

  it("is none on a platform with no binary (Windows)", async () => {
    const { updater } = await setup({ platform: "win32", platformKey: null });
    expect(updater.plan("1.1.0")).toMatchObject({ mode: "none" });
  });
});

describe("updater.spawn", () => {
  it("starts a plain detached child with a log file, the nonce in env only and no TAU_THREAD_ID", async () => {
    const { updater, seen, home } = await setup();
    await updater.spawn({ target: "1.1.0" });
    expect(seen.detached).toHaveLength(1);
    const [spawned] = seen.detached;
    expect(spawned?.command).toBe(CLI.command);
    expect(spawned?.args).toEqual([
      CLI.args[0],
      "update",
      "--target",
      "1.1.0",
      "--yes",
      "--force",
      "--home",
      home,
    ]);
    expect(spawned?.options?.logFile).toBe(join(home, "update.log"));
    expect(spawned?.options?.env?.TAU_UPDATE_JOB).toBe("nonce-1");
    expect(spawned?.options?.env?.TAU_THREAD_ID).toBeUndefined();
    expect(spawned?.options?.env?.HOME).toBe("/h");
    expect(spawned?.args.join(" ")).not.toContain("nonce-1");
  });

  it("writes an installing job file (0600, nonce, no pid yet) before spawning", async () => {
    const { updater, home } = await setup();
    await updater.spawn({ target: "1.1.0" });
    expect(readJobFile(home)).toEqual({
      state: "installing",
      target: "1.1.0",
      from: "1.0.0",
      nonce: "nonce-1",
      pid: null,
      startedAt: 1_000_000,
      error: null,
    });
    expect(statSync(jobFileOf(home)).mode & 0o777).toBe(0o600);
    expect(await updater.readJob()).toMatchObject({ state: "installing", target: "1.1.0" });
  });

  it("fails the job when the child cannot be started", async () => {
    const { runner } = recordingRunner();
    const failing: Runner = { ...runner, spawnDetached: async () => Promise.reject(new Error("EAGAIN")) };
    const node = createTestNode({ runner: failing });
    const updater = await createUpdater({
      home: node.tauHome,
      version: "1.0.0",
      context: node.context,
      cli: CLI,
      installRoot: ROOT,
      platformKey: "darwin-arm64",
      env: {},
    });
    await updater.spawn({ target: "1.1.0" });
    expect(await updater.readJob()).toMatchObject({ state: "failed", error: "EAGAIN" });
  });

  it("becomes failed in memory when the job file cannot be written", async () => {
    const { updater, home } = await setup();
    mkdirSync(home, { recursive: true });
    mkdirSync(jobFileOf(home)); // a directory where the file must go: rename fails
    await updater.spawn({ target: "1.1.0" });
    expect(await updater.readJob()).toMatchObject({ state: "failed", target: "1.1.0" });
  });

  it("honours TAU_FAKE_UPDATE only under the temp dir", async () => {
    const fake = await setup({ env: { TAU_FAKE_UPDATE: "/fake/child.js" } });
    await fake.updater.spawn({ target: "1.1.0" });
    expect(fake.seen.detached[0]?.args[0]).toBe("/fake/child.js");
  });
});

const job = (patch: Partial<JobFile>): JobFile => ({
  state: "installing",
  target: "1.1.0",
  from: "1.0.0",
  nonce: "n",
  pid: 4242,
  startedAt: 1_000_000,
  error: null,
  ...patch,
});

describe("job staleness", () => {
  const seeded = async (file: JobFile | string | undefined, options: Options = {}) => {
    const s = await setup(options);
    mkdirSync(s.home, { recursive: true });
    if (typeof file === "string") writeFileSync(jobFileOf(s.home), file);
    else if (file) writeJobFile(s.home, file);
    return s;
  };

  it("is idle without a file and for a corrupt one", async () => {
    expect((await (await seeded(undefined)).updater.readJob()).state).toBe("idle");
    expect((await (await seeded("{nope")).updater.readJob()).state).toBe("idle");
    expect((await (await seeded('{"state":"installing"}')).updater.readJob()).state).toBe("idle");
  });

  it("goes idle when the target is the current version", async () => {
    const s = await seeded(job({ target: "1.0.0", state: "restarting" }));
    expect(await s.updater.readJob()).toMatchObject({ state: "idle", target: "1.0.0" });
    expect(readJobFile(s.home)?.state).toBe("idle");
  });

  it("keeps a live child's job and fails a dead one at once", async () => {
    expect((await (await seeded(job({}))).updater.readJob()).state).toBe("installing");
    const dead = await seeded(job({ pid: 99 }));
    expect(await dead.updater.readJob()).toMatchObject({
      state: "failed",
      error: "The update stopped before it finished.",
    });
  });

  it("waits 30 s for the child to write its pid, then fails", async () => {
    let now = 1_010_000;
    const s = await seeded(job({ pid: null }), { now: () => now });
    expect((await s.updater.readJob()).state).toBe("installing");
    now = 1_031_000;
    expect((await s.updater.readJob()).state).toBe("failed");
  });

  it("fails a live job older than 10 minutes, and a later step heals it", async () => {
    const s = await seeded(job({}), { now: () => 1_000_000 + 11 * 60_000 });
    expect((await s.updater.readJob()).state).toBe("failed");
    writeJobFile(s.home, job({ state: "restarting", startedAt: 1_000_000 + 11 * 60_000 }));
    expect((await s.updater.readJob()).state).toBe("restarting");
  });

  it("clears a failed job when someone updated by hand", async () => {
    const s = await seeded(job({ state: "failed", from: "0.9.0", error: "x" }));
    expect((await s.updater.readJob()).state).toBe("idle");
    const still = await seeded(job({ state: "failed", from: "1.0.0", error: "x" }));
    expect(await still.updater.readJob()).toMatchObject({ state: "failed", error: "x" });
  });

  it("returns the last 4 KB of the log without colour codes", async () => {
    const s = await seeded(job({ state: "failed", error: "x" }));
    writeFileSync(join(s.home, "update.log"), `${"a".repeat(5000)}\u001b[31mred\u001b[0m end`);
    const tail = (await s.updater.readJob()).logTail ?? "";
    expect(tail.length).toBeLessThanOrEqual(4096);
    expect(tail.endsWith("red end")).toBe(true);
    expect(tail).not.toContain("\u001b");
  });

  it("writes atomically: no temp file is left behind", async () => {
    const s = await seeded(job({}));
    expect(readFileSync(jobFileOf(s.home), "utf8")).toContain('"nonce":"n"');
    expect(readdirSync(s.home).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
