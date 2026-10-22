import { join } from "node:path";
import type { Exec } from "../governor/exec";
import { systemdEnv } from "../governor/exec";
import { cacheDirFor } from "./profile";

/** Suffix every sandbox unit name so manager lookups never hit a scope. */
export function serviceUnit(unit: string): string {
  const name = unit.trim();
  if (!name || name.includes("/") || name.includes(" ")) {
    throw new Error(`Refusing to build a sandbox unit from ${JSON.stringify(unit)}`);
  }
  return name.endsWith(".service") ? name : `${name}.service`;
}

/** Cache writes redirect into the worktree so tools work without touching home. */
export function cacheEnvAdditions(root: string): Record<string, string> {
  const caches = cacheDirFor(root);
  return {
    PNPM_STORE_DIR: join(caches, "pnpm-store"),
    CARGO_TARGET_DIR: join(caches, "cargo-target"),
    MISE_DATA_DIR: join(caches, "mise-data"),
    MISE_CACHE_DIR: join(caches, "mise-cache"),
  };
}

/** First SSH connection must not write home `known_hosts`: keep it in the worktree. */
export function gitSshCommand(root: string, existing?: string): string {
  const base = existing?.trim() ? existing.trim() : "ssh";
  if (base.includes("UserKnownHostsFile")) return base;
  return `${base} -o UserKnownHostsFile=${join(cacheDirFor(root), "known_hosts")}`;
}

export interface SystemdSandboxInput {
  readonly systemdRun: string;
  readonly root: string;
  /** Stable per-process id (`tau-<nodehash>-<entryId>`); the `.service` suffix joins here. */
  readonly unit: string;
  /** The tool's cwd, inside the root: the service starts there (spawn cwd only reaches the client). */
  readonly workingDirectory: string;
  /** The spawn's env, forwarded deliberately as `--setenv` (the client env never reaches the service). */
  readonly env?: Readonly<Record<string, string>>;
  /** The thread's git allowlist beyond the root itself. */
  readonly adminPaths?: readonly string[];
  /** Host SSH agent socket: bind-mounted read-only, since `PrivateTmp` hides host `/tmp`. */
  readonly sshSocket?: string;
  readonly sshSocketFromEnv?: string;
}

/**
 * Transient user *service* argv (scopes cannot take sandboxing directives).
 * Nesting: this service is OUTSIDE, the governor wrap (priority+memory) goes
 * INSIDE after the `--` separator. Ends with `--`; the caller appends the
 * inner command. `--pipe --wait` keeps the client as the stable outer PID so
 * the sweep still sees it while output flows through.
 */
export function buildSystemdSandboxPrefix(input: SystemdSandboxInput): { file: string; args: string[] } {
  const caches = cacheDirFor(input.root);
  const env = { ...cacheEnvAdditions(input.root), ...(input.env ?? {}) };
  if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = gitSshCommand(input.root);
  const socket = input.sshSocket ?? input.sshSocketFromEnv;
  if (socket && !env.SSH_AUTH_SOCK) env.SSH_AUTH_SOCK = socket;
  const args = [
    "--user",
    "--pipe",
    "--wait",
    "--collect",
    `--unit=${serviceUnit(input.unit)}`,
    `--working-directory=${input.workingDirectory}`,
    "--property=ProtectSystem=strict",
    "--property=ProtectHome=read-only",
    `--property=ReadWritePaths=${input.root}`,
    `--property=ReadWritePaths=${caches}`,
    ...(input.adminPaths ?? []).map((path) => `--property=ReadWritePaths=${path}`),
    "--property=PrivateTmp=yes",
    ...(socket ? [`--property=BindReadOnlyPaths=${socket}`] : []),
    ...Object.entries(env).map(([key, value]) => `--setenv=${key}=${value}`),
    "--",
  ];
  return { file: input.systemdRun, args };
}

export interface BwrapInput {
  readonly bwrap: string;
  readonly root: string;
  readonly adminPaths?: readonly string[];
  readonly sshSocket?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * `bwrap` option where installed. No `--unshare-pid`: outer PIDs must stay
 * stable for the sweep. Ends with the inner command (caller appends it).
 */
export function buildBwrapPrefix(input: BwrapInput): { file: string; args: string[] } {
  const env = { ...cacheEnvAdditions(input.root), ...(input.env ?? {}) };
  if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = gitSshCommand(input.root);
  return {
    file: input.bwrap,
    args: [
      "--ro-bind",
      "/",
      "/",
      "--bind",
      input.root,
      input.root,
      ...(input.adminPaths ?? []).flatMap((path) => ["--bind", path, path]),
      ...(input.sshSocket ? ["--ro-bind", input.sshSocket, input.sshSocket] : []),
      "--die-with-parent",
      ...Object.entries(env).flatMap(([key, value]) => ["--setenv", key, value]),
      "--",
    ],
  };
}

/** Stop/kill the UNIT explicitly, never just the group. Best-effort: reaping paths must not throw. */
export async function stopSandboxUnit(
  exec: Exec,
  unit: string,
  signal: "stop" | "kill" = "stop",
): Promise<void> {
  const args =
    signal === "stop"
      ? ["--user", "stop", serviceUnit(unit)]
      : ["--user", "kill", serviceUnit(unit), "--signal=SIGKILL"];
  await exec("systemctl", args, { env: { ...process.env, ...systemdEnv() }, timeoutMs: 5000 }).catch(
    () => undefined,
  );
}

/**
 * Polled fallback: enumerate a unit's processes via `systemctl show <unit>
 * -p MainPID` plus the unit's `ControlGroup` cgroup-procs walk, so the sweep
 * learns units instead of only root-PID trees.
 */
export async function listSandboxUnitPids(
  exec: Exec,
  unit: string,
  readCgroupPids: (cgroup: string) => Promise<number[]>,
): Promise<number[]> {
  const shown = await exec("systemctl", ["--user", "show", serviceUnit(unit), "-p", "MainPID,ControlGroup"], {
    env: { ...process.env, ...systemdEnv() },
    timeoutMs: 5000,
  }).catch(() => undefined);
  const values = new Map(
    (shown?.stdout ?? "").split("\n").map((line) => line.split("=") as [string, string]),
  );
  const found = new Set<number>();
  const main = Number(values.get("MainPID") ?? "0");
  if (Number.isInteger(main) && main > 0) found.add(main);
  const group = values.get("ControlGroup")?.trim();
  if (group) {
    for (const pid of await readCgroupPids(group).catch(() => [] as number[])) found.add(pid);
  }
  return [...found];
}
