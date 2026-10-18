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

  async function handle(thread: ConversationSummary, options: PassOptions, result: DeleteArchivedResult) {
    try {
      const keptBecause = await decide(thread, options.force);
      if (keptBecause !== null) {
        result.kept.push({ id: thread.id, reason: keptBecause });
        return;
      }
      if (!isOldEnough(thread, options.olderThanMs)) return;
      await removal.remove(thread.id, options.force);
      result.deleted.push(thread.id);
    } catch (error) {
      result.kept.push({ id: thread.id, reason: errorReason(error) });
    }
  }

  async function runPass(options: PassOptions): Promise<DeleteArchivedResult> {
    const result: DeleteArchivedResult = { deleted: [], kept: [] };
    const archived = (await deps.listArchived()).filter((thread) => thread.parentId === null);
    for (const thread of archived) await handle(thread, options, result);
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
