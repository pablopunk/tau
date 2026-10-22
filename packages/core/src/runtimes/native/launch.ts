import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { type ProcessIdentity, RUNTIME_NONCE_ENV, readIdentity, type SupervisorDeps } from "../supervisor";

export interface LaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
}

export type Launch = (spec: LaunchSpec) => ChildProcessWithoutNullStreams;

const noop = (): void => {};

export const launchDetached: Launch = (spec) => {
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
    ...(spec.signal && { signal: spec.signal }),
  });
  child.stderr.resume();
  return child;
};

export interface SpawnBridgeDeps {
  readonly launch: Launch;
  readonly nonce: string;
  readonly supervisor: SupervisorDeps;
  readonly recordIdentity: (identity: ProcessIdentity) => Promise<void>;
  readonly refuseSpawn: () => boolean;
}

export interface SpawnBridge {
  readonly hook: (options: SpawnOptions) => SpawnedProcess;
  readonly child: () => ChildProcessWithoutNullStreams | undefined;
  /** Settles once the identity is durable; rejects when it could not be recorded. Undefined before any spawn. */
  readonly identityCommitted: () => Promise<ProcessIdentity> | undefined;
  readonly exited: () => Promise<void> | undefined;
}

const exitOf = (child: ChildProcessWithoutNullStreams): Promise<void> =>
  new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });

const bindTo = (target: object, value: unknown): unknown =>
  typeof value === "function" ? value.bind(target) : value;

/** Everything but stdin is the child itself; stdin is the gate, so the child hears nothing before its identity is durable. */
const gatedProcess = (child: ChildProcessWithoutNullStreams, gate: PassThrough): SpawnedProcess =>
  new Proxy(child as unknown as SpawnedProcess, {
    get: (target, property) =>
      property === "stdin" ? gate : bindTo(target, Reflect.get(target, property, target)),
  });

function killGroupBestEffort(child: ChildProcessWithoutNullStreams, deps: SupervisorDeps): void {
  try {
    if (child.pid !== undefined) deps.sendSignal(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export function createSpawnBridge(deps: SpawnBridgeDeps): SpawnBridge {
  let started: ChildProcessWithoutNullStreams | undefined;
  let committed: Promise<ProcessIdentity> | undefined;
  let exited: Promise<void> | undefined;

  async function commitIdentity(child: ChildProcessWithoutNullStreams, gate: PassThrough) {
    try {
      if (child.pid === undefined) throw new Error("could not start the native process");
      const identity = await readIdentity(child.pid, deps.nonce, deps.supervisor);
      if (!identity) throw new Error("the native process exited before its identity could be recorded");
      await deps.recordIdentity(identity);
      gate.pipe(child.stdin);
      return identity;
    } catch (error) {
      killGroupBestEffort(child, deps.supervisor);
      throw error;
    }
  }

  function hook(options: SpawnOptions): SpawnedProcess {
    if (deps.refuseSpawn()) throw new Error("the run was cancelled before its process started");
    if (started) throw new Error("a native run starts exactly one process");
    const child = deps.launch({ ...options, env: { ...options.env, [RUNTIME_NONCE_ENV]: deps.nonce } });
    started = child;
    child.on("error", noop);
    child.stdin.on("error", noop);
    exited = exitOf(child);
    const gate = new PassThrough();
    committed = commitIdentity(child, gate);
    committed.catch(noop);
    return gatedProcess(child, gate);
  }

  return { hook, child: () => started, identityCommitted: () => committed, exited: () => exited };
}
