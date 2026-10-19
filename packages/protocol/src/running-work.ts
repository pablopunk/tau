import type { ConversationSummary } from "./entities";

export interface RunningWork {
  readonly threads: readonly ConversationSummary[];
  readonly subagents: readonly ConversationSummary[];
  /** Threads with timers or an active goal: they resume after the restart. */
  readonly resuming: readonly ConversationSummary[];
}

/** The thread and every parent above it. */
export function lineageOf(all: readonly ConversationSummary[], ownId: string): Set<string> {
  const lineage = new Set<string>();
  let current: string | null | undefined = ownId;
  while (current && !lineage.has(current)) {
    lineage.add(current);
    current = all.find((item) => item.id === current)?.parentId;
  }
  return lineage;
}

/** What a restart would interrupt. Each thread is counted once; the caller's own lineage is left out. */
export function runningWorkOf(all: readonly ConversationSummary[], ownId?: string): RunningWork {
  const own = ownId ? lineageOf(all, ownId) : new Set<string>();
  const live = all.filter((item) => item.archivedAt === null && !own.has(item.id));
  const subagents = live.filter((item) => item.parentId !== null && item.agentStatus === "running");
  const threads = live.filter((item) => item.parentId === null && item.status === "running");
  const resuming = live.filter((item) => item.timers > 0 || item.goal?.state === "active");
  return { threads, subagents, resuming };
}

export const hasRunningWork = (work: RunningWork): boolean => work.threads.length + work.subagents.length > 0;
