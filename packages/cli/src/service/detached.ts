import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readRunningInstance } from "@tau/core";
import type { ServiceBackend } from "./backend";
import type { ServiceContext } from "./context";
import { pidFileOf, type ServiceSpec } from "./spec";

const POLL_MS = 100;
const TERM_BUDGET_MS = 20_000;
const KILL_BUDGET_MS = 2_000;
const NOTICE_AFTER_MS = 2_000;

export const WAITING_TO_STOP_NOTICE = "Waiting for tau to stop (it is closing its threads)...";

export const foregroundHolderMessage = (pid: number) =>
  `tau is already running in a terminal (pid ${pid}). Stop it (Ctrl+C), then run tau again.`;

export class ForegroundHolderError extends Error {
  constructor(readonly pid: number) {
    super(foregroundHolderMessage(pid));
    this.name = "ForegroundHolderError";
  }
}

export interface DetachedOptions {
  /** Who holds the home lock right now (live only). */
  readLock?: (home: string) => Promise<{ readonly pid: number } | undefined>;
  /** Called once when a stop takes longer than expected. */
  onWaiting?: () => void;
}

export interface DetachedBackend extends ServiceBackend {
  /** The pid of a live lock holder that is not a verified tau service server (a terminal `tau serve`). */
  foregroundHolder(spec: ServiceSpec): Promise<number | undefined>;
  /** The pid holding the home lock, if any. */
  lockHolder(spec: ServiceSpec): Promise<number | undefined>;
  /** Waited stop that leaves a server owned by another backend (`spare`) alone. */
  stopExcept(spec: ServiceSpec, spare: number | undefined): Promise<void>;
}

function readPid(file: string): number | undefined {
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** A plain background process: used when the OS has no usable service manager, or for a home with no service. */
export function createDetachedBackend(
  context: ServiceContext,
  options: DetachedOptions = {},
): DetachedBackend {
  const readLock = options.readLock ?? ((home: string) => readRunningInstance(home));
  const onWaiting = options.onWaiting ?? (() => console.log(WAITING_TO_STOP_NOTICE));

  const livePid = (spec: ServiceSpec) => {
    const pid = readPid(pidFileOf(spec.home));
    return pid !== undefined && context.isAlive(pid) ? pid : undefined;
  };

  async function isServiceServer(pid: number): Promise<boolean> {
    if (context.platform === "win32") return false;
    return ((await context.commandOf(pid)) ?? "").includes("--service");
  }

  /** The one pid a stop may signal: the pid file's when it holds the lock, else a verified `--service` lock holder. */
  async function stopTarget(spec: ServiceSpec): Promise<number | undefined> {
    const filePid = readPid(pidFileOf(spec.home));
    const lock = await readLock(spec.home);
    if (filePid !== undefined && lock?.pid === filePid) return filePid;
    if (filePid !== undefined) rmSync(pidFileOf(spec.home), { force: true });
    if (lock === undefined) return undefined;
    return (await isServiceServer(lock.pid)) ? lock.pid : undefined;
  }

  async function foregroundHolder(spec: ServiceSpec) {
    const lock = await readLock(spec.home);
    if (lock === undefined) return undefined;
    return (await isServiceServer(lock.pid)) ? undefined : lock.pid;
  }

  const hasExited = async (pid: number, spec: ServiceSpec) =>
    !context.isAlive(pid) && (await readLock(spec.home))?.pid !== pid;

  function signal(pid: number, name: NodeJS.Signals) {
    try {
      context.kill(pid, name);
    } catch {
      // already gone
    }
  }

  async function waitForExit(pid: number, spec: ServiceSpec, budgetMs: number, notify: boolean) {
    let waited = 0;
    let told = false;
    while (waited < budgetMs) {
      if (await hasExited(pid, spec)) return true;
      await context.sleep(POLL_MS);
      waited += POLL_MS;
      if (notify && !told && waited >= NOTICE_AFTER_MS) {
        told = true;
        onWaiting();
      }
    }
    return hasExited(pid, spec);
  }

  async function terminate(pid: number, spec: ServiceSpec) {
    signal(pid, "SIGTERM");
    if (await waitForExit(pid, spec, TERM_BUDGET_MS, true)) return;
    const holder = await readLock(spec.home);
    if (holder?.pid !== pid) return;
    signal(pid, "SIGKILL");
    await waitForExit(pid, spec, KILL_BUDGET_MS, false);
  }

  async function stopExcept(spec: ServiceSpec, spare: number | undefined) {
    const pid = await stopTarget(spec);
    if (pid !== undefined && pid !== spare) await terminate(pid, spec);
    if (pid !== spare) rmSync(pidFileOf(spec.home), { force: true });
  }

  async function start(spec: ServiceSpec) {
    if (livePid(spec) !== undefined) return;
    const pid = await context.runner.spawnDetached(spec.command, [...spec.args], {
      env: { ...context.env, PATH: spec.path },
    });
    if (pid === undefined) return;
    mkdirSync(dirname(pidFileOf(spec.home)), { recursive: true });
    writeFileSync(pidFileOf(spec.home), String(pid));
  }

  const stop = (spec: ServiceSpec) => stopExcept(spec, undefined);

  async function restart(spec: ServiceSpec) {
    const holder = await foregroundHolder(spec);
    if (holder !== undefined) throw new ForegroundHolderError(holder);
    await stop(spec);
    await start(spec);
  }

  return {
    kind: "detached",
    files: () => [],
    isInstalled: async () => false,
    async install(spec) {
      await start(spec);
      return { warnings: [] };
    },
    uninstall: stop,
    reload: restart,
    start,
    stop,
    restart,
    foregroundHolder,
    lockHolder: async (spec) => (await readLock(spec.home))?.pid,
    stopExcept,
    async state(spec) {
      const pid = livePid(spec);
      return { active: pid !== undefined, pid };
    },
    list: async () => [],
  };
}
