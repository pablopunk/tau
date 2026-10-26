import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { descendantEntries, type ProcessEntry, type ProcessTable, psProcessTable } from "./process-table";

export const RUNTIME_NONCE_ENV = "TAU_RUNTIME_NONCE";

export interface ProcessIdentity {
  readonly pid: number;
  readonly startTime: string;
  readonly nonce: string;
  readonly pgid: number;
}

export interface ExitStatus {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface SupervisedSpawn {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: readonly ["pipe", "pipe", "pipe"];
}

export interface SupervisedHandle {
  readonly child: ChildProcessWithoutNullStreams;
  readonly identity: ProcessIdentity;
  readonly exited: Promise<ExitStatus>;
}

export interface StopOptions {
  readonly eofGraceMs?: number;
  readonly termGraceMs?: number;
  readonly killGraceMs?: number;
  readonly verifyTimeoutMs?: number;
  readonly pollMs?: number;
}

export type StopResult =
  | {
      readonly outcome: "stopped";
      readonly elapsedMs: number;
      readonly escalated: readonly ("term" | "kill")[];
    }
  | { readonly outcome: "unknown"; readonly reason: string; readonly survivors: readonly number[] }
  | { readonly outcome: "not-running" };

export type RestartClassification = "dead" | "alive-same" | "alive-reused-pid" | "unknown";

export interface SupervisorDeps {
  readonly processTable: ProcessTable;
  /** A negative pid signals the whole process group. */
  readonly sendSignal: (pid: number, signal: NodeJS.Signals | 0) => void;
}

const DEFAULT_STOP_OPTIONS: Required<StopOptions> = {
  eofGraceMs: 500,
  termGraceMs: 1500,
  killGraceMs: 2000,
  verifyTimeoutMs: 3000,
  pollMs: 25,
};

const DEFAULT_DEPS: SupervisorDeps = {
  processTable: psProcessTable,
  sendSignal: (pid, signal) => {
    process.kill(pid, signal);
  },
};

const resolveDeps = (deps: Partial<SupervisorDeps> | undefined): SupervisorDeps => ({
  ...DEFAULT_DEPS,
  ...deps,
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const noop = (): void => {};

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isLiveEntryWithStartTime = (
  entry: ProcessEntry | undefined,
  startTime: string,
): entry is ProcessEntry => entry !== undefined && !entry.zombie && entry.startTime === startTime;

export async function readIdentity(
  pid: number,
  nonce: string,
  deps?: Partial<SupervisorDeps>,
): Promise<ProcessIdentity | undefined> {
  const entry = await resolveDeps(deps).processTable.find(pid);
  if (!entry || entry.zombie) return undefined;
  return { pid, startTime: entry.startTime, nonce, pgid: entry.pgid };
}

export async function isSameProcessAlive(
  identity: ProcessIdentity,
  deps?: Partial<SupervisorDeps>,
): Promise<boolean> {
  const entry = await resolveDeps(deps).processTable.find(identity.pid);
  return isLiveEntryWithStartTime(entry, identity.startTime);
}

export async function descendantsOf(pid: number, deps?: Partial<SupervisorDeps>): Promise<number[]> {
  const entries = await resolveDeps(deps).processTable.list();
  return descendantEntries(entries, pid).map((entry) => entry.pid);
}

export async function classifyAfterRestart(
  identity: ProcessIdentity,
  deps?: Partial<SupervisorDeps>,
): Promise<RestartClassification> {
  try {
    const entry = await resolveDeps(deps).processTable.find(identity.pid);
    if (!entry || entry.zombie) return "dead";
    return entry.startTime === identity.startTime ? "alive-same" : "alive-reused-pid";
  } catch {
    return "unknown";
  }
}

const exitStatusOf = (child: ChildProcessWithoutNullStreams): Promise<ExitStatus> =>
  new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", () => resolve({ code: null, signal: null }));
  });

function killGroupBestEffort(pgid: number, deps: SupervisorDeps): void {
  try {
    deps.sendSignal(-pgid, "SIGKILL");
  } catch {
    /* the group is already gone */
  }
}

export async function spawnSupervised(
  spec: SupervisedSpawn,
  nonce: string,
  deps?: Partial<SupervisorDeps>,
): Promise<SupervisedHandle> {
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: { ...spec.env, [RUNTIME_NONCE_ENV]: nonce },
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  const exited = exitStatusOf(child);
  child.on("error", noop);
  child.stdin.on("error", noop);
  if (child.pid === undefined) throw new Error(`could not spawn ${spec.command}`);
  const identity = await readIdentity(child.pid, nonce, deps);
  if (!identity) {
    killGroupBestEffort(child.pid, resolveDeps(deps));
    throw new Error(`${spec.command} exited before its identity could be recorded`);
  }
  return { child, identity, exited };
}

type TrackedProcesses = Map<number, string>;

function trackDescendants(tracked: TrackedProcesses, snapshot: readonly ProcessEntry[]): void {
  const byPid = new Map(snapshot.map((entry) => [entry.pid, entry]));
  for (const [pid, startTime] of [...tracked]) {
    if (!isLiveEntryWithStartTime(byPid.get(pid), startTime)) continue;
    for (const child of descendantEntries(snapshot, pid)) {
      if (!child.zombie && !tracked.has(child.pid)) tracked.set(child.pid, child.startTime);
    }
  }
}

const ownsItsGroup = (identity: ProcessIdentity): boolean => identity.pgid === identity.pid;

function groupExists(identity: ProcessIdentity, deps: SupervisorDeps): boolean {
  if (!ownsItsGroup(identity)) return false;
  try {
    deps.sendSignal(-identity.pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function survivorsIn(
  snapshot: readonly ProcessEntry[],
  tracked: TrackedProcesses,
  identity: ProcessIdentity,
  deps: SupervisorDeps,
): number[] {
  const byPid = new Map(snapshot.map((entry) => [entry.pid, entry]));
  const alive = [...tracked].filter(([pid, startTime]) =>
    isLiveEntryWithStartTime(byPid.get(pid), startTime),
  );
  const pids = alive.map(([pid]) => pid);
  if (pids.length === 0 && groupExists(identity, deps)) return [identity.pgid];
  return pids;
}

function trySignal(pid: number, signal: NodeJS.Signals, deps: SupervisorDeps): void {
  try {
    deps.sendSignal(pid, signal);
  } catch {
    /* gone already, or not ours to signal; verification reports what is left */
  }
}

function signalVerifiedTargets(
  signal: NodeJS.Signals,
  snapshot: readonly ProcessEntry[],
  tracked: TrackedProcesses,
  identity: ProcessIdentity,
  deps: SupervisorDeps,
): void {
  if (groupExists(identity, deps)) trySignal(-identity.pgid, signal, deps);
  const byPid = new Map(snapshot.map((entry) => [entry.pid, entry]));
  for (const [pid, startTime] of tracked) {
    if (isLiveEntryWithStartTime(byPid.get(pid), startTime)) trySignal(pid, signal, deps);
  }
}

interface StopRun {
  readonly identity: ProcessIdentity;
  readonly tracked: TrackedProcesses;
  readonly settings: Required<StopOptions>;
  readonly deps: SupervisorDeps;
}

const probeSurvivors = async (run: StopRun): Promise<number[]> =>
  survivorsIn(await run.deps.processTable.list(), run.tracked, run.identity, run.deps);

async function survivorsAfterWaiting(run: StopRun, timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let survivors = await probeSurvivors(run);
  while (survivors.length > 0 && Date.now() < deadline) {
    await sleep(run.settings.pollMs);
    survivors = await probeSurvivors(run);
  }
  return survivors;
}

async function signalAndWait(signal: NodeJS.Signals, graceMs: number, run: StopRun): Promise<number[]> {
  const snapshot = await run.deps.processTable.list();
  trackDescendants(run.tracked, snapshot);
  signalVerifiedTargets(signal, snapshot, run.tracked, run.identity, run.deps);
  return survivorsAfterWaiting(run, graceMs);
}

function closeStdin(child: ChildProcessWithoutNullStreams): void {
  if (!child.stdin.destroyed) child.stdin.end();
}

async function escalateUntilGone(
  run: StopRun,
  child: ChildProcessWithoutNullStreams | undefined,
): Promise<{ escalated: ("term" | "kill")[]; survivors: number[] }> {
  const escalated: ("term" | "kill")[] = [];
  trackDescendants(run.tracked, await run.deps.processTable.list());
  if (child) closeStdin(child);
  let survivors = await survivorsAfterWaiting(run, child ? run.settings.eofGraceMs : 0);
  if (survivors.length > 0) {
    escalated.push("term");
    survivors = await signalAndWait("SIGTERM", run.settings.termGraceMs, run);
  }
  if (survivors.length > 0) {
    escalated.push("kill");
    survivors = await signalAndWait("SIGKILL", run.settings.killGraceMs, run);
  }
  if (survivors.length > 0) survivors = await survivorsAfterWaiting(run, run.settings.verifyTimeoutMs);
  return { escalated, survivors };
}

const identityOf = (target: SupervisedHandle | ProcessIdentity): ProcessIdentity =>
  "child" in target ? target.identity : target;

const childOf = (target: SupervisedHandle | ProcessIdentity): ChildProcessWithoutNullStreams | undefined =>
  "child" in target ? target.child : undefined;

async function runStop(
  target: SupervisedHandle | ProcessIdentity,
  run: StopRun,
  startedAt: number,
): Promise<StopResult> {
  if (!(await isSameProcessAlive(run.identity, run.deps))) return { outcome: "not-running" };
  const { escalated, survivors } = await escalateUntilGone(run, childOf(target));
  if (survivors.length > 0) {
    return {
      outcome: "unknown",
      reason: `still alive after ${run.settings.verifyTimeoutMs}ms of verification: ${survivors.join(", ")}`,
      survivors,
    };
  }
  return { outcome: "stopped", elapsedMs: Date.now() - startedAt, escalated };
}

export async function stopSupervised(
  target: SupervisedHandle | ProcessIdentity,
  options?: StopOptions,
  deps?: Partial<SupervisorDeps>,
): Promise<StopResult> {
  const identity = identityOf(target);
  const run: StopRun = {
    identity,
    tracked: new Map([[identity.pid, identity.startTime]]),
    settings: { ...DEFAULT_STOP_OPTIONS, ...options },
    deps: resolveDeps(deps),
  };
  try {
    return await runStop(target, run, Date.now());
  } catch (error) {
    return {
      outcome: "unknown",
      reason: `process table unavailable: ${describeError(error)}`,
      survivors: [],
    };
  }
}

export const stopByIdentity = (
  identity: ProcessIdentity,
  options?: StopOptions,
  deps?: Partial<SupervisorDeps>,
): Promise<StopResult> => stopSupervised(identity, options, deps);
