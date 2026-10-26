import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, DEFAULT_SANDBOX_SETTINGS, type SandboxSettings } from "@tau/protocol";
import { systemdEnv } from "../../processes/governor/exec";
import type { SandboxScope, ThreadClass } from "../../processes/governor/governed";
import { findOnPath, type HostPlatform, hostPlatform } from "../../processes/governor/wrap-command";
import { gitReadWritePaths } from "../../processes/sandbox/git-scope";
import { probeSandboxSupport } from "../../processes/sandbox/sandbox-support";
import { isInsideRoot, resolveSandboxRoot, type TrustInput } from "../../processes/sandbox/trust-root";
import { cacheEnvAdditions, gitSshCommand, serviceUnit } from "../../processes/sandbox/unit";
import {
  type SandboxBackend,
  type SandboxSupport,
  sandboxBackend,
  sandboxEnabled,
  sandboxPrefix,
} from "../../processes/sandbox/wrap";
import { RUNTIME_NONCE_ENV } from "../supervisor";
import type { PrepareResult } from "./controller";
import type { Launch, LaunchSpec } from "./launch";

const SCOPES_IN_ORDER: readonly ThreadClass[] = ["main", "worktree", "subagent"];
const CLAUDE_STATE_DIRECTORY = ".claude";
const CLAUDE_STATE_FILE = ".claude.json";

export type NativeSpawnOptions = {
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: readonly ["pipe", "pipe", "pipe"];
  readonly detached: true;
  readonly signal?: AbortSignal;
};

export type NativeSpawn = (
  file: string,
  args: readonly string[],
  options: NativeSpawnOptions,
) => ChildProcessWithoutNullStreams;

export interface NativeSandboxSource {
  /** The node's live sandbox switch; absent means the staging gate (everything off). */
  readonly settings: () => Promise<SandboxSettings | undefined> | SandboxSettings | undefined;
  /** The thread's real scope; `unknown` when it cannot be resolved (sandboxed fail-closed when any scope is on). */
  readonly scopeOf: (threadId: string) => Promise<SandboxScope>;
  /** Trusted thread metadata the sandbox root comes from, never the SDK's cwd. */
  readonly trustOf: (threadId: string) => Promise<TrustInput | undefined>;
  readonly support?: () => SandboxSupport;
  /** The real home: the SDK keeps its session and config files under it. */
  readonly home?: string;
  readonly tmp?: string;
  /** Prefer `bwrap` over the systemd service, whose unit would outlive a killed client. Default true. */
  readonly preferBwrap?: boolean;
}

export interface NativeLaunchPolicyDeps {
  readonly sandbox: NativeSandboxSource;
  readonly spawn?: NativeSpawn;
}

export type NativeRunPolicy = {
  readonly prepare: () => Promise<PrepareResult>;
  readonly launch: Launch;
};

type SandboxedPlan = {
  readonly kind: "sandboxed";
  readonly scope: ThreadClass;
  readonly root: string;
  readonly settings: SandboxSettings;
  readonly support: SandboxSupport;
  readonly adminPaths: readonly string[];
  readonly preferBwrap: boolean;
};

export type NativeLaunchPlan = { readonly kind: "plain" } | SandboxedPlan;

export interface NativeLaunchPolicy {
  /** Throws `forbidden` when the sandbox is on for the thread's scope and cannot be enforced. */
  plan(threadId: string, cwd: string): Promise<NativeLaunchPlan>;
  forThread(threadId: string, cwd: string): NativeRunPolicy;
}

const forbidden = (message: string): AppError => new AppError("forbidden", message);

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The scope whose sandbox switch applies to this spawn, or `null` when none does. */
export function policyScopeOf(scope: SandboxScope, settings: SandboxSettings): ThreadClass | null {
  if (scope !== "unknown") return sandboxEnabled(settings, scope) ? scope : null;
  return SCOPES_IN_ORDER.find((candidate) => sandboxEnabled(settings, candidate)) ?? null;
}

export function hostSandboxSupport(platform: HostPlatform = hostPlatform()): SandboxSupport {
  if (platform === "macos") return { platform, binaries: probeSandboxSupport(platform).binaries };
  if (platform !== "linux") return { platform, binaries: {} };
  const systemdRun = findOnPath("systemd-run");
  const bwrap = findOnPath("bwrap");
  return { platform, binaries: { ...(systemdRun && { systemdRun }), ...(bwrap && { bwrap }) } };
}

const realTmp = (): string => {
  try {
    return realpathSync(tmpdir());
  } catch {
    return tmpdir();
  }
};

type ClaudeStateRoots = { readonly home: string; readonly tmp: string; readonly backend: SandboxBackend };

/**
 * The only writable paths granted beyond the thread root and its git paths: the SDK's session and config
 * directory under the real home, its config file, and the temp directory (a systemd service has a private one).
 * Seatbelt rules never need the path to exist; bind-based backends fail on a missing one, so it is left out.
 */
export function claudeStateWritablePaths({ home, tmp, backend }: ClaudeStateRoots): string[] {
  const wanted = [
    join(home, CLAUDE_STATE_DIRECTORY),
    join(home, CLAUDE_STATE_FILE),
    ...(backend === "systemd" ? [] : [tmp]),
  ];
  return backend === "seatbelt" ? wanted : wanted.filter((path) => existsSync(path));
}

function gitAdminPathsOf(root: string, trusted: TrustInput | undefined): string[] {
  if (!trusted) return [];
  const { adminDir, sharedGitDir, branch } = trusted;
  if (adminDir && sharedGitDir && branch) {
    return gitReadWritePaths({ worktreeRoot: root, adminDir, sharedGitDir, branch }).filter(
      (path) => path !== root,
    );
  }
  return adminDir ? [adminDir] : [];
}

const definedEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

const spawnDetached: NativeSpawn = (file, args, options) => {
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
    ...(options.signal && { signal: options.signal }),
  });
  child.stderr.resume();
  return child;
};

function unitOf(threadId: string, spec: LaunchSpec): string {
  const nonce = spec.env[RUNTIME_NONCE_ENV] ?? String(process.pid);
  return serviceUnit(`tau-native-${threadId}-${nonce}`);
}

function spawnEnvOf(plan: SandboxedPlan, backend: SandboxBackend | null, env: Record<string, string>) {
  if (backend === "systemd") return { ...env, ...systemdEnv() };
  if (backend !== "seatbelt") return env;
  const withCaches = { ...cacheEnvAdditions(plan.root), ...env };
  return withCaches.GIT_SSH_COMMAND
    ? withCaches
    : { ...withCaches, GIT_SSH_COMMAND: gitSshCommand(plan.root) };
}

export function nativeLaunchPolicy(deps: NativeLaunchPolicyDeps): NativeLaunchPolicy {
  const { sandbox } = deps;
  const spawnChild = deps.spawn ?? spawnDetached;
  const preferBwrap = sandbox.preferBwrap ?? true;
  const supportOf = sandbox.support ?? (() => hostSandboxSupport());

  async function plan(threadId: string, cwd: string): Promise<NativeLaunchPlan> {
    const settings = (await sandbox.settings()) ?? DEFAULT_SANDBOX_SETTINGS;
    const scope = policyScopeOf(await sandbox.scopeOf(threadId), settings);
    if (scope === null) return { kind: "plain" };
    const trusted = await sandbox.trustOf(threadId);
    const resolved = resolveSandboxRoot(trusted);
    if (!resolved.ok) throw forbidden(resolved.reason);
    if (!isInsideRoot(resolved.root, cwd)) {
      throw forbidden(`The native run starts outside the sandbox root ${resolved.root}: denied.`);
    }
    const support = supportOf();
    const backend = sandboxBackend(support, preferBwrap);
    if (!backend) {
      throw forbidden(
        "Sandboxing is on for this thread but unsupported on this host: denied, never silently unenforced.",
      );
    }
    const stateRoots = { home: sandbox.home ?? homedir(), tmp: sandbox.tmp ?? realTmp(), backend };
    return {
      kind: "sandboxed",
      scope,
      root: resolved.root,
      settings,
      support,
      adminPaths: [...gitAdminPathsOf(resolved.root, trusted), ...claudeStateWritablePaths(stateRoots)],
      preferBwrap,
    };
  }

  function launchSandboxed(threadId: string, wrap: SandboxedPlan, spec: LaunchSpec) {
    if (spec.cwd !== undefined && !isInsideRoot(wrap.root, spec.cwd)) {
      throw forbidden(`The native run starts outside the sandbox root ${wrap.root}: denied.`);
    }
    const env = definedEnv(spec.env);
    const prefix = sandboxPrefix({
      root: wrap.root,
      scope: wrap.scope,
      settings: wrap.settings,
      support: wrap.support,
      unit: unitOf(threadId, spec),
      workingDirectory: spec.cwd ?? wrap.root,
      env,
      adminPaths: wrap.adminPaths,
      preferBwrap: wrap.preferBwrap,
    });
    if (!prefix) throw forbidden("Sandboxing is on but no enforcement path applies: denied.");
    const backend = sandboxBackend(wrap.support, wrap.preferBwrap);
    return spawnChild(prefix.file, [...prefix.args, spec.command, ...spec.args], {
      ...(spec.cwd !== undefined && { cwd: spec.cwd }),
      env: spawnEnvOf(wrap, backend, env),
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      ...(spec.signal && { signal: spec.signal }),
    });
  }

  function forThread(threadId: string, cwd: string): NativeRunPolicy {
    let prepared: NativeLaunchPlan | undefined;
    return {
      async prepare() {
        prepared = undefined;
        try {
          prepared = await plan(threadId, cwd);
          return { ok: true };
        } catch (error) {
          return { ok: false, reason: describeError(error) };
        }
      },
      launch(spec) {
        if (!prepared) throw forbidden("The native launch was never planned: denied.");
        if (prepared.kind === "sandboxed") return launchSandboxed(threadId, prepared, spec);
        return spawnChild(spec.command, spec.args, {
          ...(spec.cwd !== undefined && { cwd: spec.cwd }),
          env: spec.env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: true,
          ...(spec.signal && { signal: spec.signal }),
        });
      },
    };
  }

  return { plan, forThread };
}
