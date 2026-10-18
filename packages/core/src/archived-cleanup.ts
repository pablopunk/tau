import {
  type ConversationSummary,
  type DeleteArchivedInput,
  type DeleteArchivedResult,
  unmergedKindsOf,
  unmergedWarningFor,
} from "@tau/protocol";
import type { ConversationRemoval } from "./conversation-removal";
import type { ConversationStore } from "./harness/conversation-store";
import type { RemovalHooks } from "./removal-hooks";

export const ARCHIVE_RETENTION_MS = 48 * 60 * 60 * 1000;
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export interface ArchivedCleanup {
  deleteArchived(input: DeleteArchivedInput): Promise<DeleteArchivedResult>;
  /** Runs a pass now and then every hour. */
  start(): void;
  /** Clears the timer and waits for a pass in flight. */
  stop(): Promise<void>;
}

interface CleanupDeps {
  readonly conversations: ConversationStore;
  readonly removal: ConversationRemoval;
  readonly hooks: RemovalHooks;
  readonly listArchived: () => Promise<ConversationSummary[]>;
  readonly now: () => number;
  readonly announce: (projectId: string) => void;
  readonly onError?: (error: unknown) => void;
}

interface PassOptions {
  readonly force: boolean;
  readonly olderThanMs: number;
}

const errorReason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createArchivedCleanup(deps: CleanupDeps): ArchivedCleanup {
  const { conversations, removal, hooks, now, announce } = deps;
  const onError = deps.onError ?? ((error) => console.error("tau: archived cleanup failed", error));
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<unknown> = Promise.resolve();

  const isOldEnough = (thread: ConversationSummary, olderThanMs: number) =>
    thread.archivedAt !== null && now() - thread.archivedAt >= olderThanMs;

  async function rememberWarning(thread: ConversationSummary, warning: string | null) {
    if (await conversations.setUnmergedWarning(thread.id, warning)) announce(thread.projectId);
  }

  async function decide(thread: ConversationSummary, force: boolean): Promise<string | null> {
    if (thread.status === "running") return "The thread is running.";
    const lost = await hooks.unmergedWork(thread);
    const warning =
      lost.length > 0 ? unmergedWarningFor(thread.workspace.branch, unmergedKindsOf(lost)) : null;
    await rememberWarning(thread, warning);
    return warning !== null && !force ? warning : null;
  }

  type Verdict = { thread: ConversationSummary; keptBecause: string | null };

  async function verdictFor(thread: ConversationSummary, options: PassOptions): Promise<Verdict> {
    try {
      return { thread, keptBecause: await decide(thread, options.force) };
    } catch (error) {
      return { thread, keptBecause: errorReason(error) };
    }
  }

  async function deleteOne(thread: ConversationSummary, force: boolean, result: DeleteArchivedResult) {
    try {
      await removal.remove(thread.id, force);
      result.deleted.push(thread.id);
    } catch (error) {
      result.kept.push({ id: thread.id, reason: errorReason(error) });
    }
  }

  function logPass(options: PassOptions, threads: number, result: DeleteArchivedResult, startedAt: number) {
    if (options.olderThanMs !== 0) return;
    console.log(
      `tau: delete archived force=${options.force} threads=${threads} deleted=${result.deleted.length} kept=${result.kept.length} tookMs=${Date.now() - startedAt}`,
    );
  }

  async function runPass(options: PassOptions): Promise<DeleteArchivedResult> {
    const startedAt = Date.now();
    const result: DeleteArchivedResult = { deleted: [], kept: [] };
    const archived = (await deps.listArchived()).filter((thread) => thread.parentId === null);
    const verdicts = await Promise.all(archived.map((thread) => verdictFor(thread, options)));
    const shortlist: ConversationSummary[] = [];
    for (const { thread, keptBecause } of verdicts) {
      if (keptBecause !== null) result.kept.push({ id: thread.id, reason: keptBecause });
      else if (isOldEnough(thread, options.olderThanMs)) shortlist.push(thread);
    }
    for (const thread of shortlist) await deleteOne(thread, options.force, result);
    logPass(options, archived.length, result, startedAt);
    return result;
  }

  function track<T>(run: Promise<T>): Promise<T> {
    inFlight = Promise.all([inFlight, run.catch(() => undefined)]);
    return run;
  }

  return {
    deleteArchived: ({ force }) => track(runPass({ force, olderThanMs: 0 })),
    start() {
      const sweep = () =>
        void track(runPass({ force: false, olderThanMs: ARCHIVE_RETENTION_MS })).catch(onError);
      sweep();
      timer = setInterval(sweep, CLEANUP_INTERVAL_MS);
      timer.unref();
    },
    async stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      await inFlight;
    },
  };
}
