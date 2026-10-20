import { sleep } from "../process-group";
import { membersOf, type ProcRow, type Sweep } from "./ps-sweep";

export const SWEEP_MS = 2000;
export const FAST_SWEEP_MS = 1000;
export const FIRST_SWEEP_AFTER_MS = 2000;
export const AFTER_EXIT_MS = 30_000;
const HOT_FRACTION = 0.5;
const HARD_FACTOR = 1.5;

export interface WatchRequest {
  readonly rootPid: number;
  readonly limitMb: number;
  /** Runs before the first signal: the service records the `memory` reason. */
  readonly onOverLimit: () => void;
}

export interface WatchHandle {
  /** The root shell exited; the watch goes on until every sticky member is gone or 30 s pass. */
  rootExited(): void;
  stop(): void;
}

export interface MemoryWatch {
  watch(request: WatchRequest): WatchHandle;
  /** One sweep now; the timer calls it. */
  sweepNow(): Promise<void>;
  size(): number;
}

export interface WatchDeps {
  readonly sweep: Sweep;
  readonly now?: () => number;
  readonly graceMs: number;
  readonly signal?: (pid: number, signal: NodeJS.Signals) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

interface Item {
  readonly request: WatchRequest;
  readonly startedAt: number;
  readonly sticky: Map<number, string>;
  overSweeps: number;
  exitedAt?: number;
  killing: boolean;
}

const defaultSignal = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(pid, signal);
  } catch {
    // gone already
  }
};

export function createMemoryWatch(deps: WatchDeps): MemoryWatch {
  const now = deps.now ?? Date.now;
  const signal = deps.signal ?? defaultSignal;
  const wait = deps.sleep ?? sleep;
  const items = new Set<Item>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fast = false;

  const remember = (item: Item, members: readonly ProcRow[]) => {
    for (const member of members) item.sticky.set(member.pid, member.start);
  };

  /** Signals only pids whose start time still matches the one stored when first seen. */
  const signalFrom = (item: Item, rows: readonly ProcRow[], which: NodeJS.Signals) => {
    for (const member of membersOf(rows, item.request.rootPid, item.sticky)) {
      if (item.sticky.get(member.pid) === member.start) signal(member.pid, which);
    }
  };

  const kill = async (item: Item, detection: readonly ProcRow[]) => {
    item.killing = true;
    item.request.onOverLimit();
    signalFrom(item, detection, "SIGTERM");
    await wait(deps.graceMs);
    signalFrom(item, await deps.sweep(), "SIGKILL");
    items.delete(item);
  };

  const judge = (item: Item, rows: readonly ProcRow[]) => {
    const members = membersOf(rows, item.request.rootPid, item.sticky);
    remember(item, members);
    if (members.length === 0 && item.exitedAt !== undefined) return items.delete(item);
    if (item.exitedAt !== undefined && now() - item.exitedAt > AFTER_EXIT_MS) return items.delete(item);
    const limit = item.request.limitMb * 1024;
    const used = members.reduce((sum, member) => sum + member.rssKb, 0);
    if (members.some((member) => member.rssKb > limit * HOT_FRACTION)) fast = true;
    item.overSweeps = used > limit ? item.overSweeps + 1 : 0;
    if (used > limit * HARD_FACTOR || item.overSweeps >= 2) void kill(item, rows);
  };

  async function sweepNow() {
    const eligible = [...items].filter((item) => !item.killing && now() - item.startedAt >= FIRST_SWEEP_AFTER_MS);
    if (eligible.length === 0) return;
    fast = false;
    const rows = await deps.sweep();
    for (const item of eligible) judge(item, rows);
  }

  const schedule = () => {
    if (timer || items.size === 0) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        void sweepNow()
          .catch(() => undefined)
          .finally(schedule);
      },
      fast ? FAST_SWEEP_MS : SWEEP_MS,
    );
    timer.unref();
  };

  return {
    watch(request) {
      const item: Item = { request, startedAt: now(), sticky: new Map(), overSweeps: 0, killing: false };
      items.add(item);
      schedule();
      return {
        rootExited() {
          item.exitedAt = now();
        },
        stop() {
          items.delete(item);
        },
      };
    },
    sweepNow,
    size: () => items.size,
  };
}
