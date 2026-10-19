import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServiceManager } from "../service/manager";
import type { CommandResult, DetachedOptions, Runner, RunOptions } from "../service/runner";
import { CLI, createTestNode } from "../service/test-context";
import { jobFileOf, readJobFile, writeJobFile } from "./job-file";
import { createUpdater, type JobFile, type UpdaterDeps } from "./updater";

const NPM_ENTRY = "/usr/local/lib/node_modules/@pablopunk/tau/dist/bin.js";
const PNPM_ENTRY =
  "/h/Library/pnpm/global/5/node_modules/.pnpm/@pablopunk+tau@1.0.0/node_modules/@pablopunk/tau/dist/bin.js";

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
  entry?: string;
  platform?: NodeJS.Platform;
  installService?: boolean;
  respond?: (line: string) => Partial<CommandResult> | undefined;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  alive?: (pid: number) => boolean;
  version?: string;
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
    entry: options.entry ?? NPM_ENTRY,
    execPath: "/n/bin/node",
    env: options.env ?? { PATH: "/usr/bin", TAU_THREAD_ID: "t1", HOME: "/h" },
    now: options.now ?? (() => 1_000_000),
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

  it("runs on pnpm and mise installs too when detached", async () => {
    expect((await setup({ entry: PNPM_ENTRY })).updater.plan("1.1.0").mode).toBe("run");
    const mise = "/h/.local/share/mise/installs/node/22/lib/node_modules/@pablopunk/tau/dist/bin.js";
    expect((await setup({ entry: mise })).updater.plan("1.1.0").mode).toBe("run");
  });

  it("is manual on an unverified launchd service, with the latest command", async () => {
    const { updater } = await setup({ installService: true });
    expect(updater.plan("1.1.0")).toMatchObject({
      mode: "manual",
      command: "npm i -g @pablopunk/tau@latest && tau restart",
    });
    const pnpm = await setup({ installService: true, entry: PNPM_ENTRY });
    expect(pnpm.updater.plan("1.1.0").command).toBe("pnpm add -g @pablopunk/tau@latest && tau restart");
  });

  it("is manual on an unverified systemd service and probes systemctl once", async () => {
    const { updater, seen } = await setup({
      platform: "linux",
      installService: true,
      respond: (line) => (line === "systemctl --version" ? { stdout: "systemd 255 (255)\n" } : undefined),
    });
    expect(updater.plan("1.1.0").mode).toBe("manual");
    updater.plan("1.1.0");
    expect(seen.runs.filter((r) => r.command === "systemctl" && r.args[0] === "--version")).toHaveLength(1);
  });

  it.each([
    [
      "npx",
      "/h/.npm/_npx/abc/node_modules/@pablopunk/tau/dist/bin.js",
      "manual",
      "npm i -g @pablopunk/tau@latest && tau restart",
    ],
    [
      "bun",
      "/h/.bun/install/global/node_modules/@pablopunk/tau/dist/bin.js",
      "manual",
      "bun add -g @pablopunk/tau@1.1.0",
    ],
    [
      "volta",
      "/h/.volta/tools/image/packages/@pablopunk/tau/lib/node_modules/@pablopunk/tau/dist/bin.js",
      "manual",
      "volta install @pablopunk/tau@1.1.0",
    ],
    ["dev checkout", "/h/src/tau/packages/cli/dist/bin.js", "none", null],
  ])("%s", async (_name, entry, mode, command) => {
    const { updater } = await setup({ entry });
    expect(updater.plan("1.1.0")).toMatchObject({ mode, command });
  });

  it("is manual on Windows", async () => {
    const { updater } = await setup({
      platform: "win32",
      entry: "C:/x/lib/node_modules/@pablopunk/tau/dist/bin.js",
    });
    expect(updater.plan("1.1.0")).toMatchObject({ mode: "manual", command: "npm i -g @pablopunk/tau@1.1.0" });
  });
});

describe("updater.spawn", () => {
  it("starts a plain detached child with a log file, the nonce in env only and no TAU_THREAD_ID", async () => {
    const { updater, seen, home } = await setup();
    await updater.spawn({ target: "1.1.0" });
    expect(seen.detached).toHaveLength(1);
    const [spawned] = seen.detached;
    expect(spawned?.command).toBe(CLI.node);
    expect(spawned?.args).toEqual([
      CLI.entry,
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
      entry: NPM_ENTRY,
      execPath: "/n/bin/node",
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
