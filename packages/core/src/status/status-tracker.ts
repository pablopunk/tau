import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import type { ConversationStatus } from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "../change-emitter";
import {
  indexOf,
  readMeta,
  scanAppConversations,
  updateLiveConversation,
} from "../harness/conversation-index";
import { isBusy, lastAnswerFailed, observeBusyChanges } from "../harness/live-state";
import { createSerialQueue } from "../home/serial-queue";

export interface StatusTrackerDeps {
  readonly changes: ChangeEmitter;
  readonly now: () => number;
}

export interface StatusTracker {
  /** Called from `beforeResume`: subscribes to commits before the Harness resumes. */
  attach(harness: Harness): void;
  /** Recomputes the status of entries stored as running. */
  recoverAtStartup(): Promise<void>;
  /** Called after a thread's run ended and its status was recorded. Listener errors are logged, never thrown. */
  onRunEnded(listener: (conversationId: string) => Promise<void>): void;
  /** Resolves once every status write and run-end listener queued so far has finished. */
  settled(): Promise<void>;
}

type RunState = { busy: boolean; runEnded: boolean };

export function createStatusTracker(deps: StatusTrackerDeps): StatusTracker {
  const states = new Map<string, RunState>();
  const enqueue = createSerialQueue();
  const runEndedListeners: ((conversationId: string) => Promise<void>)[] = [];
  const logRunEndFailure = (error: unknown) =>
    console.error("pi-everywhere: a run-end listener failed", error);
  let attached: Harness | undefined;
  let closed = false;

  const harnessOrThrow = () => {
    if (!attached) throw new Error("The status tracker is not attached to a Harness.");
    return attached;
  };

  async function statusOf(harness: Harness, id: ConversationId, busy: boolean): Promise<ConversationStatus> {
    if (busy) return "running";
    return (await lastAnswerFailed(harness, id)) ? "error" : "idle";
  }

  async function flush(conversationId: string): Promise<void> {
    const harness = harnessOrThrow();
    const state = states.get(conversationId);
    const id = Number(conversationId) as ConversationId;
    const meta = state ? await readMeta(harness, id) : undefined;
    if (!state || !meta || meta.deletedAt !== undefined) return;
    const status = await statusOf(harness, id, state.busy);
    const runEnded = state.runEnded;
    state.runEnded = false;
    const written = await updateLiveConversation(harness, id, meta.projectId, (_meta, entry) => {
      if ((entry.status ?? "idle") === status && !runEnded) return false;
      entry.status = status;
      if (runEnded) entry.lastRunEndedAt = deps.now();
      return true;
    });
    if (written) deps.changes.emit({ resource: "conversations", projectId: meta.projectId });
    if (runEnded)
      for (const listener of runEndedListeners) await listener(conversationId).catch(logRunEndFailure);
  }

  function scheduleFlush(conversationId: string): void {
    queueMicrotask(() => {
      enqueue(() => flush(conversationId)).catch((error) => {
        if (!closed) console.error("pi-everywhere: could not record a thread status", error);
      });
    });
  }

  function record(conversationId: string, busy: boolean): void {
    const state = states.get(conversationId) ?? { busy: false, runEnded: false };
    states.set(conversationId, state);
    if (state.busy === busy) return;
    state.busy = busy;
    if (!busy) state.runEnded = true;
    scheduleFlush(conversationId);
  }

  async function seedFromStorage(harness: Harness): Promise<void> {
    for (const { id, meta } of await scanAppConversations(harness)) {
      const key = String(id);
      if (meta.deletedAt !== undefined || states.has(key)) continue;
      const busy = await isBusy(harness, id);
      states.set(key, { busy, runEnded: false });
      const entry = (await indexOf(harness, meta.projectId)).find(
        (candidate) => candidate.conversationId === id,
      );
      const storedRunning = entry?.status === "running" && entry.pendingStart !== true;
      if (storedRunning && !busy) scheduleFlush(key);
    }
  }

  return {
    attach(harness) {
      attached = harness;
      harness.subscribeClose(() => {
        closed = true;
      });
      observeBusyChanges(harness, ({ conversationId, busy }) => record(conversationId, busy));
    },
    onRunEnded(listener) {
      runEndedListeners.push(listener);
    },
    settled: () => enqueue(async () => undefined),
    async recoverAtStartup() {
      await seedFromStorage(harnessOrThrow());
      await enqueue(async () => undefined);
    },
  };
}
