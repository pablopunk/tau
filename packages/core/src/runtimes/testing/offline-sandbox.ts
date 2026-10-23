import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";

export const FAKE_API_KEY = "sk-ant-api03-FAKE-KEY-offline-spike-0000";
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const BASE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

export const sandboxExecAvailable = (): boolean => process.platform === "darwin" && existsSync(SANDBOX_EXEC);

export interface OfflineWorld {
  readonly root: string;
  readonly home: string;
  readonly cwd: string;
  readonly tmp: string;
  readonly profile: string;
  readonly fixturePath: string;
  readonly fixtureText: string;
}

/** Everything the child may touch lives under `root`, a fresh directory in the OS temp dir. */
export function createOfflineWorld(fixtureText: string): OfflineWorld {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tau-offline-sdk-")));
  const [home, cwd, tmp] = ["home", "cwd", "tmp"].map((name) => join(root, name)) as [string, string, string];
  for (const dir of [home, cwd, tmp]) mkdirSync(dir);
  const fixturePath = join(cwd, "fixture.txt");
  writeFileSync(fixturePath, `${fixtureText}\n`);
  const profile = join(root, "network-deny.sb");
  writeFileSync(profile, sandboxProfile(root));
  return { root, home, cwd, tmp, profile, fixturePath, fixtureText };
}

/** Writes only under `root`, reads nothing from the real home directory, talks only to loopback. */
export const sandboxProfile = (root: string): string =>
  [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    '(allow network-outbound (remote ip "localhost:*"))',
    '(allow network-bind (local ip "localhost:*"))',
    '(allow network-inbound (local ip "localhost:*"))',
    "(deny file-write*)",
    `(allow file-write* (subpath "${root}"))`,
    '(allow file-write* (literal "/dev/null") (literal "/dev/dtracehelper") (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$"))',
    `(deny file-read* (subpath "${realpathSync(homedir())}"))`,
  ].join("\n");

export const childEnvironment = (world: OfflineWorld, baseUrl: string): Record<string, string> => ({
  PATH: BASE_PATH,
  HOME: world.home,
  USER: "offline",
  TMPDIR: world.tmp,
  CLAUDE_CODE_TMPDIR: world.tmp,
  XDG_CONFIG_HOME: join(world.home, ".config"),
  XDG_DATA_HOME: join(world.home, ".local", "share"),
  XDG_CACHE_HOME: join(world.home, ".cache"),
  XDG_STATE_HOME: join(world.home, ".local", "state"),
  CLAUDE_CONFIG_DIR: join(world.home, ".claude"),
  ANTHROPIC_API_KEY: FAKE_API_KEY,
  ANTHROPIC_BASE_URL: baseUrl,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_TELEMETRY: "1",
  DISABLE_ERROR_REPORTING: "1",
  DISABLE_AUTOUPDATER: "1",
  DISABLE_BUG_COMMAND: "1",
  DISABLE_COST_WARNINGS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  NO_PROXY: "127.0.0.1,localhost",
});

const SDK_VARIABLE = /^(CLAUDE_CODE_|CLAUDE_AGENT_SDK)/;
const CREDENTIAL_NAME = /TOKEN|KEY|SECRET|OAUTH|AUTH|PASSWORD/;

/** The variables the SDK adds for its own child; nothing inherited from the parent shell passes through. */
const sdkOwnVariables = (env: SpawnOptions["env"]): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && SDK_VARIABLE.test(entry[0]) && !CREDENTIAL_NAME.test(entry[0]),
    ),
  );

export interface SandboxedSpawns {
  readonly spawn: (options: SpawnOptions) => SpawnedProcess;
  /** Every child started so far, newest last. */
  readonly children: readonly { kill(signal: NodeJS.Signals): boolean }[];
  /** SIGKILLs the newest child and everything it started (its tool subprocesses survive a plain kill). */
  readonly killNewestTree: () => void;
  /** SIGKILLs every child's process group; leaves nothing behind. */
  readonly killAllTrees: () => void;
  /** The stderr of every child, for failure messages. */
  readonly stderr: () => string;
}

const parentTable = (): Map<number, number[]> => {
  const table = new Map<number, number[]>();
  for (const line of execFileSync("/bin/ps", ["-axo", "pid=,ppid="], { encoding: "utf8" }).split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || Number.isNaN(pid)) continue;
    table.set(ppid, [...(table.get(ppid) ?? []), pid]);
  }
  return table;
};

const descendantsOf = (pid: number, table: Map<number, number[]>): number[] =>
  (table.get(pid) ?? []).flatMap((child) => [...descendantsOf(child, table), child]);

/** Tool subprocesses start their own session, so the process group is not enough: walk the parent table. */
const killTree = (child: ReturnType<typeof spawn> | undefined): void => {
  if (!child?.pid) return;
  const doomed = [...descendantsOf(child.pid, parentTable()), child.pid];
  for (const pid of doomed) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
};

/** The SDK's spawn hook: runs the SDK's own command under `sandbox-exec` with a clean, synthetic environment. */
export function sandboxedSpawns(world: OfflineWorld, baseUrl: string): SandboxedSpawns {
  const children: ReturnType<typeof spawn>[] = [];
  let stderr = "";
  return {
    children,
    killNewestTree: () => killTree(children.at(-1)),
    killAllTrees: () => children.forEach(killTree),
    stderr: () => stderr,
    spawn(options) {
      const env = { ...sdkOwnVariables(options.env), ...childEnvironment(world, baseUrl) };
      const child = spawn(SANDBOX_EXEC, ["-f", world.profile, options.command, ...options.args], {
        cwd: options.cwd,
        env: env as Record<string, string>,
        stdio: ["pipe", "pipe", "pipe"],
        signal: options.signal,
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      children.push(child);
      return child as unknown as SpawnedProcess;
    },
  };
}

/** Relative paths of everything below `dir`, with sizes, sorted. */
export function listTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const stats = statSync(full);
      out.push(`${full.slice(dir.length + 1)}${stats.isDirectory() ? "/" : ` (${stats.size}B)`}`);
      if (stats.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out;
}
