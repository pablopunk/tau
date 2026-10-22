import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { LockInfo } from "@tau/core";
import type { ConversationSummary } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { summary } from "../commands/test-support";
import { createServiceManager } from "../service/manager";
import { pidFileOf } from "../service/spec";
import { CLI, createTestNode } from "../service/test-context";
import { type CommandResult, spawnCommand } from "./command-runner";
import { currentVersionOf, serverRecordOf, swapCurrent } from "./install-layout";
import { readJobFile, writeJobFile } from "./job-file";
import type { Release } from "./latest-version";
import type { LinkedNodes } from "./nodes-behind";
import { runUpdateWith } from "./run-update";
import type { UpdateDeps } from "./update-deps";
import type { JobFile } from "./updater";

const OLD: LockInfo = { pid: 4242, url: "http://127.0.0.1:4317", version: "1.0.0" };
const ok: CommandResult = { code: 0, stdout: "", stderr: "" };
const PLATFORM = "darwin-arm64";

/** A real `tar.gz` with `tau-<v>-<platform>/tau`, so the install code extracts for real. */
function archiveOf(version: string): { bytes: Buffer; sha: string } {
  const work = mkdtempSync(join(tmpdir(), "tau-archive-"));
  const folder = join(work, `tau-${version}-${PLATFORM}`);
  mkdirSync(folder);
  writeFileSync(join(folder, "tau"), "#!/bin/sh\n");
  const file = join(work, "a.tar.gz");
  execFileSync("tar", ["-czf", file, "-C", work, basename(folder)]);
  const bytes = execFileSync("cat", [file], { maxBuffer: 1 << 26 });
  return { bytes, sha: createHash("sha256").update(bytes).digest("hex") };
}

interface Options {
  latest?: string | Error;
  instance?: LockInfo;
  active?: boolean;
  tty?: boolean;
  env?: Record<string, string>;
  conversations?: ConversationSummary[];
  /** The new server never comes up: a restart leaves the old version. */
  staysOld?: boolean;
  badSum?: boolean;
  badBinary?: boolean;
  noRelease?: boolean;
  /** `null`: a dev checkout. */
  devCheckout?: boolean;
  noPrevious?: boolean;
  restart?: CommandResult;
  ancestors?: number[];
  hub?: boolean;
  confirm?: boolean;
  linked?: LinkedNodes | Error;
  pid?: number;
}

async function setup(options: Options = {}) {
  const node = createTestNode({}, (line) =>
    options.active !== false && line.startsWith("launchctl print gui/501/")
      ? { stdout: "pid = 4242\n" }
      : undefined,
  );
  if (options.active !== false) await createServiceManager(node.context, CLI, node.tauHome).install();
  const root = mkdtempSync(join(tmpdir(), "tau-root-"));
  for (const version of options.noPrevious ? [] : ["1.0.0"]) {
    mkdirSync(join(root, "versions", version), { recursive: true });
    writeFileSync(join(root, "versions", version, "tau"), "");
  }
  if (!options.noPrevious) swapCurrent(root, "1.0.0");
  const out: string[] = [];
  const err: string[] = [];
  const commands: { command: string; args: readonly string[]; stdio: string }[] = [];
  const instance = { current: "instance" in options ? options.instance : OLD };
  const archive = archiveOf("1.1.0");
  const fetched: string[] = [];
  const fakeFetch = (async (input: string | URL) => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith(".tar.gz")) return new Response(archive.bytes);
    const sha = options.badSum ? "0".repeat(64) : archive.sha;
    return new Response(`${sha}  tau-1.1.0-${PLATFORM}.tar.gz\n`);
  }) as typeof fetch;
  const release = (version: string): Release => ({
    version,
    archiveName: `tau-${version}-${PLATFORM}.tar.gz`,
    archiveUrl: `https://releases.test/tau-${version}-${PLATFORM}.tar.gz`,
    sumsUrl: "https://releases.test/SHA256SUMS",
  });
  const deps: UpdateDeps = {
    context: node.context,
    cli: () => CLI,
    version: () => "1.0.0",
    readInstance: async () => instance.current,
    waitForInstanceUrl: async () => instance.current,
    readToken: async () => "tok",
    openBrowser: async () => undefined,
    out: (m) => void out.push(m),
    err: (m) => void err.push(m),
    fileExists: () => true,
    runCommand: async (command, args, o) => {
      commands.push({ command, args, stdio: o.stdio });
      if (command === "tar") return spawnCommand(command, args, o);
      if (args[0] === "--version") {
        const printed = options.badBinary ? "9.9.9" : basename(dirname(command));
        return { code: 0, stdout: `${printed}\n`, stderr: "" };
      }
      if (args[1] === "restart") {
        const result = options.restart ?? ok;
        if (result.code === 0 && instance.current) {
          const version =
            options.staysOld && currentVersionOf(root) !== "1.0.0" ? "1.0.0" : currentVersionOf(root);
          instance.current = { ...instance.current, version: version ?? "1.0.0" };
        }
        return result;
      }
      return ok;
    },
    latestVersion: async () => {
      if (options.latest instanceof Error) throw options.latest;
      return options.latest ?? "1.1.0";
    },
    installRoot: options.devCheckout ? undefined : root,
    platformKey: PLATFORM,
    fetch: fakeFetch,
    findRelease: async (version) => {
      if (options.noRelease) throw new Error("release 1.1.0 has no archive yet");
      return release(version);
    },
    listConversations: async () => options.conversations ?? [],
    confirm: async () => options.confirm ?? true,
    isTty: options.tty ?? true,
    env: options.env ?? {},
    pid: options.pid,
    ancestorPids: options.ancestors ? async () => options.ancestors ?? [] : undefined,
    pollRunningVersion: async () => instance.current?.version,
    hasHubFile: () => options.hub ?? false,
    linkedNodes: options.linked
      ? async () => {
          if (options.linked instanceof Error) throw options.linked;
          return options.linked;
        }
      : undefined,
  };
  return { home: node.tauHome, deps, out, err, commands, instance, root, fetched };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const installCalls = (s: Setup) => s.commands.filter((c) => c.command === "tar");
const restartCalls = (s: Setup) => s.commands.filter((c) => c.args[1] === "restart");
const _NEW: LockInfo = { ...OLD, version: "1.1.0" };

describe("tau update --check", () => {
  it("exits 0 when current and 10 when an update exists, touching nothing", async () => {
    const same = await setup({ latest: "1.0.0" });
    expect(await runUpdateWith(same.deps, ["--check"])).toBe(0);
    const behind = await setup();
    expect(await runUpdateWith(behind.deps, ["--check"])).toBe(10);
    expect(behind.out).toEqual(["1.0.0 -> 1.1.0"]);
    expect(behind.commands).toEqual([]);
  });
  it("exits 1 when the release check fails", async () => {
    const s = await setup({ latest: new Error("offline") });
    expect(await runUpdateWith(s.deps, ["--check"])).toBe(1);
    expect(s.err).toEqual(["offline"]);
  });
  it("ignores the other flags", async () => {
    const s = await setup({ tty: false });
    expect(await runUpdateWith(s.deps, ["--check", "--force", "--no-restart"])).toBe(10);
  });
});

describe("tau update --check linked nodes", () => {
  const m = (name: string, tauVersion: string) => ({ name, tauVersion });
  it("lists nodes behind the hub latest, unknown ones too, exit code unchanged", async () => {
    const s = await setup({
      latest: "1.0.0",
      linked: { hubLatest: "1.1.0", nodes: [m("Homelab", "1.0.0"), m("Laptop", "1.1.0"), m("New", "")] },
    });
    expect(await runUpdateWith(s.deps, ["--check"])).toBe(0);
    expect(s.out).toEqual(["1.0.0 -> 1.0.0", "Linked nodes behind: Homelab (1.0.0), New (version unknown)"]);
  });
  it("says nothing when no node is behind, no server runs or the request fails", async () => {
    const none = await setup({ linked: { hubLatest: null, nodes: [m("A", "1.1.0")] } });
    expect(await runUpdateWith(none.deps, ["--check"])).toBe(10);
    expect(none.out).toEqual(["1.0.0 -> 1.1.0"]);
    const down = await setup();
    expect(await runUpdateWith(down.deps, ["--check"])).toBe(10);
    const broken = await setup({ linked: new Error("boom") });
    expect(await runUpdateWith(broken.deps, ["--check"])).toBe(10);
    expect(broken.out).toEqual(["1.0.0 -> 1.1.0"]);
    expect(broken.err).toEqual([]);
  });
});

describe("tau update", () => {
  it("says when already current and does nothing", async () => {
    const s = await setup({ latest: "1.0.0" });
    expect(await runUpdateWith(s.deps, [])).toBe(0);
    expect(s.out[0]).toContain("up to date");
    expect(s.commands).toEqual([]);
  });

  it("downloads, verifies, extracts, swaps current, restarts the stable binary and prunes", async () => {
    const s = await setup({ hub: true });
    mkdirSync(join(s.root, "versions", "0.9.0"));
    expect(await runUpdateWith(s.deps, ["--yes", "--home", s.home, "--port", "5000"]), s.err.join()).toBe(0);
    expect(s.fetched).toEqual([
      "https://releases.test/tau-1.1.0-darwin-arm64.tar.gz",
      "https://releases.test/SHA256SUMS",
    ]);
    expect(existsSync(join(s.root, "versions", "1.1.0", "tau"))).toBe(true);
    expect(currentVersionOf(s.root)).toBe("1.1.0");
    expect(readlinkSync(join(s.root, "current"))).toBe(join("versions", "1.1.0"));
    expect(existsSync(join(s.root, "versions", "0.9.0"))).toBe(false);
    expect(existsSync(join(s.root, "versions", "1.0.0"))).toBe(true);
    expect(s.commands.find((c) => c.args[0] === "--version")?.command).toBe(
      join(s.root, "versions", "1.1.0", "tau"),
    );
    expect(restartCalls(s)).toEqual([
      {
        command: CLI.command,
        args: [...CLI.args, "restart", "--home", s.home, "--port", "5000"],
        stdio: "inherit",
      },
    ]);
    expect(s.out.join("\n")).toContain("Linked nodes must run the same tau version");
  });

  it("never prunes the folder the running server started from", async () => {
    const s = await setup();
    mkdirSync(join(s.root, "versions", "0.9.0"));
    writeFileSync(
      serverRecordOf(s.home),
      JSON.stringify({ pid: 4242, versionDir: join(s.root, "versions", "0.9.0") }),
    );
    expect(await runUpdateWith(s.deps, ["--yes", "--home", s.home])).toBe(0);
    expect(existsSync(join(s.root, "versions", "0.9.0"))).toBe(true);
  });

  it("forwards only the flags typed", async () => {
    const s = await setup();
    await runUpdateWith(s.deps, ["--yes"]);
    expect(restartCalls(s)[0]?.args).toEqual([...CLI.args, "restart"]);
  });

  it("installs the missing service for a background tau before the restart step", async () => {
    const s = await setup({ active: false });
    mkdirSync(s.home, { recursive: true });
    writeFileSync(pidFileOf(s.home), "4242");
    const calls = (s.deps.context.runner as unknown as { calls: string[] }).calls;
    expect(await runUpdateWith(s.deps, ["--yes", "--home", s.home]), s.err.join("\n")).toBe(0);
    expect(calls.findIndex((line) => line.startsWith("launchctl bootstrap"))).toBeGreaterThanOrEqual(0);
    expect(existsSync(pidFileOf(s.home))).toBe(false);
    expect(restartCalls(s)).toHaveLength(1);
  });

  it("rolls current back and restarts when the new server never reports the target", async () => {
    const s = await setup({ staysOld: true });
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
    expect(s.err.join("\n")).toContain("still reports version 1.0.0");
    expect(s.err.join("\n")).toContain("Rolled back to tau 1.0.0");
    expect(currentVersionOf(s.root)).toBe("1.0.0");
    expect(restartCalls(s)).toHaveLength(2);
    expect(s.instance.current?.version).toBe("1.0.0");
  });

  it("rolls back when `tau restart` fails", async () => {
    const s = await setup({ restart: { code: 1, stdout: "", stderr: "no" } });
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
    expect(currentVersionOf(s.root)).toBe("1.0.0");
  });

  it("keeps the new version and says so when there is no previous one", async () => {
    const s = await setup({ staysOld: true, noPrevious: true });
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
    expect(s.err.join("\n")).toContain("no previous version");
    expect(currentVersionOf(s.root)).toBe("1.1.0");
  });

  it("asks only when needed", async () => {
    const noTty = await setup({ tty: false });
    expect(await runUpdateWith(noTty.deps, [])).toBe(1);
    expect(noTty.err.join()).toContain("Add --yes");
    expect(installCalls(noTty)).toEqual([]);
    const declined = await setup({ confirm: false });
    expect(await runUpdateWith(declined.deps, [])).toBe(0);
    expect(installCalls(declined)).toEqual([]);
  });

  it.each([
    ["a bad checksum", { badSum: true }, "does not match SHA256SUMS"],
    ["a binary that prints another version", { badBinary: true }, "does not run"],
    ["a release with no archive", { noRelease: true }, "no archive yet"],
  ] as [string, Options, string][])("changes nothing on %s", async (_name, options, message) => {
    const s = await setup(options);
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
    expect(s.err.join()).toContain(message);
    expect(currentVersionOf(s.root)).toBe("1.0.0");
    expect(existsSync(join(s.root, "versions", "1.1.0"))).toBe(false);
    expect(restartCalls(s)).toEqual([]);
  });

  it("refuses with running threads unless --force, in a terminal or not", async () => {
    const conversations = [summary("a", { status: "running", title: "Build" })];
    for (const tty of [true, false]) {
      const s = await setup({ conversations, tty });
      expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
      expect(s.err.join()).toContain("Running threads: 1");
      expect(installCalls(s)).toEqual([]);
    }
    const forced = await setup({ conversations });
    await runUpdateWith(forced.deps, ["--yes", "--force"]);
    expect(restartCalls(forced)).toHaveLength(1);
  });

  it("does not block on timers and goals, and excludes its own lineage", async () => {
    const conversations = [
      summary("p", { status: "running" }),
      summary("me", { parentId: "p", agentStatus: "running", status: "running" }),
      summary("t", { timers: 2 }),
    ];
    const s = await setup({ conversations, env: { TAU_THREAD_ID: "me" }, ancestors: [] });
    await runUpdateWith(s.deps, ["--yes", "--no-restart"]);
    const r = await setup({ conversations: [summary("t", { timers: 2 })] });
    await runUpdateWith(r.deps, ["--yes"]);
    expect(r.out.join()).toContain("will resume");
    expect(restartCalls(r)).toHaveLength(1);
  });

  it("refuses to restart inside tau (env and ancestor pids) and puts current back", async () => {
    const env = await setup({ env: { TAU_THREAD_ID: "me" } });
    expect(await runUpdateWith(env.deps, ["--yes"])).toBe(1);
    expect(restartCalls(env)).toEqual([]);
    expect(env.err.join()).toContain("running inside tau");
    expect(currentVersionOf(env.root)).toBe("1.0.0");
    const ps = await setup({ ancestors: [1234, 4242] });
    expect(await runUpdateWith(ps.deps, ["--yes"])).toBe(1);
    expect(restartCalls(ps)).toEqual([]);
  });

  it("--no-restart installs only, even inside tau with running work", async () => {
    const s = await setup({
      env: { TAU_THREAD_ID: "me" },
      conversations: [summary("a", { status: "running" })],
    });
    expect(await runUpdateWith(s.deps, ["--yes", "--no-restart"])).toBe(0);
    expect(s.out.join()).toContain("tau restart");
    expect(restartCalls(s)).toEqual([]);
    expect(currentVersionOf(s.root)).toBe("1.1.0");
  });

  it("tells a foreground server to restart itself", async () => {
    const s = await setup({ active: false });
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(0);
    expect(s.out.join()).toContain("Ctrl-C");
    expect(restartCalls(s)).toEqual([]);
  });

  it("only installs when nothing runs", async () => {
    const s = await setup({ instance: undefined, active: false });
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(0);
    expect(s.out.join()).toContain("tau start");
    expect(installCalls(s)).toHaveLength(1);
    expect(restartCalls(s)).toEqual([]);
  });

  it("waits for a server that comes up after the update instead of saying it is not running", async () => {
    const s = await setup({ instance: undefined, active: false });
    const waits: number[] = [];
    const deps = {
      ...s.deps,
      pollRunningVersion: async (_home: string, version: string, timeoutMs: number) => {
        waits.push(timeoutMs);
        return version;
      },
    };
    expect(await runUpdateWith(deps, ["--yes"])).toBe(0);
    expect(waits).toEqual([30_000]);
    expect(s.out.join()).not.toContain("tau start");
    expect(s.out.join()).toContain("is running");
  });

  it("refuses in a dev checkout", async () => {
    const s = await setup({ devCheckout: true });
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
    expect(s.err.join()).toContain("development checkout");
    expect(s.commands).toEqual([]);
  });
});

describe("tau update --target (the detached child)", () => {
  const seed = (home: string, patch: Partial<JobFile> = {}) =>
    writeJobFile(home, {
      state: "installing",
      target: "1.1.0",
      from: "1.0.0",
      nonce: "abc",
      pid: null,
      startedAt: 1,
      error: null,
      ...patch,
    });

  it("rejects a target that is not a plain version before anything runs", async () => {
    const s = await setup();
    for (const bad of ["latest", "1.1", "1.1.0-beta.1", "1.1.0; rm -rf /", ""]) {
      expect(await runUpdateWith(s.deps, ["--target", bad, "--yes"])).toBe(1);
    }
    expect(s.commands).toEqual([]);
    expect(s.err[0]).toContain("--target needs a plain version");
  });

  it("installs exactly the target, not a fresh latest, and never prompts without a terminal", async () => {
    const s = await setup({ latest: new Error("releases down"), tty: false });
    expect(await runUpdateWith(s.deps, ["--target", "1.1.0", "--yes", "--force"])).toBe(0);
    expect(s.err.join()).not.toContain("releases down");
    expect(currentVersionOf(s.root)).toBe("1.1.0");
  });

  it("reports pid, restarting and idle to the job file and survives the inside-server check", async () => {
    const s = await setup({ env: { TAU_UPDATE_JOB: "abc" }, pid: 777, ancestors: [4242] });
    seed(s.home);
    const code = await runUpdateWith(s.deps, ["--target", "1.1.0", "--yes", "--force", "--home", s.home]);
    expect(code).toBe(0);
    expect(readJobFile(s.home)).toMatchObject({ state: "idle", pid: 777, error: null });
    expect(restartCalls(s)).toHaveLength(1);
  });

  it("writes failed with the old version as `from` after a rollback", async () => {
    const s = await setup({ env: { TAU_UPDATE_JOB: "abc" }, pid: 777, staysOld: true });
    seed(s.home);
    expect(await runUpdateWith(s.deps, ["--target", "1.1.0", "--yes", "--force", "--home", s.home])).toBe(1);
    expect(readJobFile(s.home)).toMatchObject({ state: "failed", from: "1.0.0", target: "1.1.0" });
    expect(readJobFile(s.home)?.error).toContain("still reports version 1.0.0");
    expect(currentVersionOf(s.root)).toBe("1.0.0");
  });

  it("writes failed with the error when the install fails", async () => {
    const s = await setup({ env: { TAU_UPDATE_JOB: "abc" }, pid: 777, badSum: true });
    seed(s.home);
    expect(await runUpdateWith(s.deps, ["--target", "1.1.0", "--yes", "--force", "--home", s.home])).toBe(1);
    expect(readJobFile(s.home)).toMatchObject({ state: "failed", pid: 777 });
    expect(readJobFile(s.home)?.error).toContain("The install failed");
  });

  it("keeps refusing inside tau with TAU_THREAD_ID even with a valid nonce, and for a wrong nonce or pid", async () => {
    const thread = await setup({ env: { TAU_UPDATE_JOB: "abc", TAU_THREAD_ID: "me" }, pid: 777 });
    seed(thread.home, { pid: 777 });
    expect(await runUpdateWith(thread.deps, ["--yes", "--home", thread.home])).toBe(1);
    expect(restartCalls(thread)).toEqual([]);
    const wrongNonce = await setup({ env: { TAU_UPDATE_JOB: "zzz" }, pid: 777, ancestors: [4242] });
    seed(wrongNonce.home, { pid: 777 });
    expect(await runUpdateWith(wrongNonce.deps, ["--yes", "--home", wrongNonce.home])).toBe(1);
    expect(restartCalls(wrongNonce)).toEqual([]);
    const wrongPid = await setup({ env: { TAU_UPDATE_JOB: "abc" }, pid: 1, ancestors: [4242] });
    seed(wrongPid.home, { pid: 777 });
    expect(await runUpdateWith(wrongPid.deps, ["--yes", "--home", wrongPid.home])).toBe(1);
    expect(restartCalls(wrongPid)).toEqual([]);
  });

  it("does not prompt: a valid nonce with a recorded pid skips the ancestry check on a plain `tau update` too", async () => {
    const s = await setup({ env: { TAU_UPDATE_JOB: "abc" }, pid: 777, ancestors: [4242], tty: false });
    seed(s.home, { pid: 777 });
    await runUpdateWith(s.deps, ["--yes", "--home", s.home]);
    expect(restartCalls(s)).toHaveLength(1);
  });
});
