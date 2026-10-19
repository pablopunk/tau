import type { LockInfo } from "@tau/core";
import type { ConversationSummary } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { summary } from "../commands/test-support";
import { createServiceManager } from "../service/manager";
import { CLI, createTestMachine } from "../service/test-context";
import type { CommandResult } from "./command-runner";
import { runUpdateWith } from "./run-update";
import type { UpdateDeps } from "./update-deps";

const ENTRY = "/usr/local/lib/node_modules/@pablopunk/tau/dist/bin.js";
const PKG = "/usr/local/lib/node_modules/@pablopunk/tau";
const OLD: LockInfo = { pid: 4242, url: "http://127.0.0.1:4317", version: "1.0.0" };
const ok: CommandResult = { code: 0, stdout: "", stderr: "" };

interface Options {
  latest?: string | Error;
  instance?: LockInfo;
  active?: boolean;
  tty?: boolean;
  env?: Record<string, string>;
  conversations?: ConversationSummary[];
  installed?: string;
  install?: CommandResult;
  statusJson?: CommandResult;
  restart?: CommandResult;
  entry?: string;
  ancestors?: number[];
  hub?: boolean;
  confirm?: boolean;
}

async function setup(options: Options = {}) {
  const machine = createTestMachine({}, (line) =>
    options.active !== false && line.startsWith("launchctl print gui/501/")
      ? { stdout: "pid = 4242\n" }
      : undefined,
  );
  if (options.active !== false) await createServiceManager(machine.context, CLI, machine.tauHome).install();
  const out: string[] = [];
  const err: string[] = [];
  const commands: { command: string; args: readonly string[]; stdio: string }[] = [];
  const instance = { current: "instance" in options ? options.instance : OLD };
  const deps: UpdateDeps = {
    context: machine.context,
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
      if (args[0] === "i") return options.install ?? ok;
      if (args[1] === "status")
        return options.statusJson ?? { code: 0, stdout: JSON.stringify({ cliVersion: "1.1.0" }), stderr: "" };
      if (args[1] === "restart") return options.restart ?? ok;
      return ok;
    },
    latestVersion: async () => {
      if (options.latest instanceof Error) throw options.latest;
      return options.latest ?? "1.1.0";
    },
    listConversations: async () => options.conversations ?? [],
    confirm: async () => options.confirm ?? true,
    isTty: options.tty ?? true,
    env: options.env ?? {},
    execPath: "/n/bin/node",
    entry: options.entry ?? ENTRY,
    realpath: (p) => p,
    readPackageVersion: () => options.installed ?? "1.1.0",
    ancestorPids: options.ancestors ? async () => options.ancestors ?? [] : undefined,
    pollInstance: async (_home, version) =>
      instance.current?.version === version ? instance.current : instance.current,
    hasHubFile: () => options.hub ?? false,
  };
  return { home: machine.tauHome, deps, out, err, commands, instance };
}

const installCalls = (s: Awaited<ReturnType<typeof setup>>) => s.commands.filter((c) => c.args[0] === "i");
const restartCalls = (s: Awaited<ReturnType<typeof setup>>) =>
  s.commands.filter((c) => c.args[1] === "restart");
const NEW: LockInfo = { ...OLD, version: "1.1.0" };

describe("tau update --check", () => {
  it("exits 0 when current and 10 when an update exists, touching nothing", async () => {
    const same = await setup({ latest: "1.0.0" });
    expect(await runUpdateWith(same.deps, ["--check"])).toBe(0);
    const behind = await setup();
    expect(await runUpdateWith(behind.deps, ["--check"])).toBe(10);
    expect(behind.out).toEqual(["1.0.0 -> 1.1.0"]);
    expect(behind.commands).toEqual([]);
  });
  it("exits 1 when the registry is unreachable", async () => {
    const s = await setup({ latest: new Error("offline") });
    expect(await runUpdateWith(s.deps, ["--check"])).toBe(1);
    expect(s.err).toEqual(["offline"]);
  });
  it("ignores the other flags", async () => {
    const s = await setup({ tty: false });
    expect(await runUpdateWith(s.deps, ["--check", "--force", "--no-restart"])).toBe(10);
  });
});

describe("tau update", () => {
  it("says when already current and does nothing", async () => {
    const s = await setup({ latest: "1.0.0" });
    expect(await runUpdateWith(s.deps, [])).toBe(0);
    expect(s.out[0]).toContain("up to date");
    expect(s.commands).toEqual([]);
  });

  it("installs the exact version without a shell, verifies, restarts in the new binary, and succeeds on the lock version", async () => {
    const s = await setup({ hub: true });
    const poll = s.deps.pollInstance;
    const flipped: UpdateDeps = {
      ...s.deps,
      pollInstance: async (h, v) => {
        s.instance.current = NEW;
        return poll(h, v);
      },
    };
    expect(await runUpdateWith(flipped, ["--yes", "--home", s.home, "--port", "5000"])).toBe(0);
    expect(installCalls(s)).toEqual([
      { command: "/n/bin/npm", args: ["i", "-g", "@pablopunk/tau@1.1.0"], stdio: "tee" },
    ]);
    expect(restartCalls(s)).toEqual([
      {
        command: "/n/bin/node",
        args: [`${PKG}/dist/bin.js`, "restart", "--home", s.home, "--port", "5000"],
        stdio: "inherit",
      },
    ]);
    const status = s.commands.find((c) => c.args[1] === "status");
    expect(status?.args).toEqual([`${PKG}/dist/bin.js`, "status", "--home", s.home, "--json"]);
    expect(s.out.join("\n")).toContain("Linked machines must run the same tau version");
    expect(s.out.join("\n")).toContain("linked to a hub");
  });

  it("forwards only the flags typed", async () => {
    const s = await setup();
    await runUpdateWith(s.deps, ["--yes"]);
    expect(restartCalls(s)[0]?.args).toEqual([`${PKG}/dist/bin.js`, "restart"]);
  });

  it("fails with the skew message when the lock keeps the old version (also a stale detached restart)", async () => {
    const s = await setup();
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
    expect(s.err.join("\n")).toContain("still reports version 1.0.0");
  });

  it("fails when no lock is left after the restart", async () => {
    const s = await setup();
    const gone: UpdateDeps = { ...s.deps, pollInstance: async () => undefined };
    expect(await runUpdateWith(gone, ["--yes"])).toBe(1);
    expect(s.err.join("\n")).toContain("tau status");
  });

  it("asks only when needed", async () => {
    expect(await runUpdateWith((await setup({ tty: false })).deps, [])).toBe(1);
    const noTty = await setup({ tty: false });
    await runUpdateWith(noTty.deps, []);
    expect(noTty.err.join()).toContain("Add --yes");
    expect(installCalls(noTty)).toEqual([]);
    const declined = await setup({ confirm: false });
    expect(await runUpdateWith(declined.deps, [])).toBe(0);
    expect(installCalls(declined)).toEqual([]);
  });

  it("explains EACCES with the manual command and does not restart", async () => {
    const s = await setup({ install: { code: 243, stdout: "", stderr: "npm error code EACCES" } });
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
    expect(s.err.join()).toContain("Permission denied");
    expect(s.err.join()).toContain("npm i -g @pablopunk/tau@1.1.0");
    expect(restartCalls(s)).toEqual([]);
  });

  it("reports another install failure with a rollback command", async () => {
    const s = await setup({ install: { code: 1, stdout: "", stderr: "boom" } });
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
    expect(s.err.join()).toContain("npm i -g @pablopunk/tau@1.0.0");
  });

  it.each([
    ["wrong version on disk", { installed: "1.0.0" }],
    ["status crashes", { statusJson: { code: 1, stdout: "", stderr: "Cannot find module" } }],
    [
      "status reports another version",
      { statusJson: { code: 0, stdout: JSON.stringify({ cliVersion: "1.0.0" }), stderr: "" } },
    ],
    ["status is not JSON", { statusJson: { code: 0, stdout: "oops", stderr: "" } }],
  ] as [string, Options][])("does not restart when verify fails: %s", async (_name, options) => {
    const s = await setup(options);
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
    expect(restartCalls(s)).toEqual([]);
    expect(s.err.join()).toContain("old server still runs on old in-memory code");
  });

  it("refuses with running threads unless --force, in a terminal or not", async () => {
    const conversations = [summary("a", { status: "running", title: "Build" })];
    for (const tty of [true, false]) {
      const s = await setup({ conversations, tty });
      expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
      expect(s.err.join()).toContain("Running threads: 1");
      expect(s.err.join()).toContain("--force");
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

  it("installs but refuses to restart inside tau (env and ancestor pids)", async () => {
    const env = await setup({ env: { TAU_THREAD_ID: "me" } });
    expect(await runUpdateWith(env.deps, ["--yes"])).toBe(1);
    expect(installCalls(env)).toHaveLength(1);
    expect(restartCalls(env)).toEqual([]);
    expect(env.err.join()).toContain("running inside tau");
    const ps = await setup({ ancestors: [1234, 4242] });
    expect(await runUpdateWith(ps.deps, ["--yes"])).toBe(1);
    expect(restartCalls(ps)).toEqual([]);
  });

  it("--no-restart installs and verifies only, even inside tau with running work", async () => {
    const s = await setup({
      env: { TAU_THREAD_ID: "me" },
      conversations: [summary("a", { status: "running" })],
    });
    expect(await runUpdateWith(s.deps, ["--yes", "--no-restart"])).toBe(0);
    expect(s.out.join()).toContain("tau restart");
    expect(restartCalls(s)).toEqual([]);
    expect(s.commands.some((c) => c.args[1] === "status")).toBe(true);
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

  it("prints the manual command for a layout it will not touch", async () => {
    const s = await setup({ entry: "/h/.bun/install/global/node_modules/@pablopunk/tau/dist/bin.js" });
    expect(await runUpdateWith(s.deps, ["--yes"])).toBe(1);
    expect(s.err.join()).toContain("bun add -g @pablopunk/tau@1.1.0");
    expect(s.commands).toEqual([]);
  });
});
