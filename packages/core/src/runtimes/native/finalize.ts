import { AppError, type ConversationStatus, type ConversationSummary, type Core } from "@tau/protocol";
import type { CheckpointService } from "../../checkpoints/checkpoint-service";
import type { CheckpointStore } from "../../checkpoints/checkpoint-store";
import { repoOf } from "../../checkpoints/repo";
import type { NativeThreadRef } from "../../harness/conversation-native";
import type { SettleOutcome } from "../../harness/runtime-store";
import type { PrepareResult } from "./controller";

export interface NativeCheckpointPort {
  /** False when the thread has no git work tree to snapshot (or its workspace is gone): nothing is protected. */
  applies(threadId: string): Promise<boolean>;
  /** Like Pi's, never throws and never says whether it worked; `hasBefore` does. */
  snapshotBefore(threadId: string, requestId: string): Promise<void>;
  hasBefore(threadId: string, requestId: string): Promise<boolean>;
  snapshotAfter(threadId: string, operationId: string): Promise<void>;
}

export interface NativeCheckpointPortDeps {
  readonly checkpoints: Pick<CheckpointService, "snapshotBefore" | "snapshotAfter">;
  readonly store: Pick<CheckpointStore, "read">;
  readonly find: (threadId: string) => Promise<ConversationSummary | undefined>;
  readonly repoOf?: typeof repoOf;
}

export function createNativeCheckpointPort(deps: NativeCheckpointPortDeps): NativeCheckpointPort {
  const repoOfFolder = deps.repoOf ?? repoOf;
  return {
    async applies(threadId) {
      const thread = await deps.find(threadId);
      if (!thread || thread.workspace.state === "removed") return false;
      return (await repoOfFolder(thread.workspace.path)) !== undefined;
    },
    snapshotBefore: (threadId, requestId) => deps.checkpoints.snapshotBefore(threadId, requestId),
    async hasBefore(threadId, requestId) {
      const { items } = await deps.store.read(threadId);
      return items.some((item) => item.kind === "before" && item.requestId === requestId);
    },
    snapshotAfter: (threadId, operationId) => deps.checkpoints.snapshotAfter(threadId, operationId),
  };
}

export type FinalizeStep = "checkpoint-after" | "index-and-changes";

export type FinalizeReport = {
  readonly operationId: string;
  readonly outcome: SettleOutcome;
  readonly duplicate: boolean;
  readonly steps: readonly FinalizeStep[];
  readonly status: ConversationStatus;
};

export interface NativeFinalizer {
  /** Takes the before-snapshot when checkpoints apply; a failed snapshot refuses the run (protected mode). */
  checkpointBefore(threadId: string, requestId: string): Promise<PrepareResult>;
  /** Runs the after-run work once per operation id; a replay changes nothing. */
  finalize(
    thread: NativeThreadRef,
    operation: { readonly operationId: string; readonly outcome: SettleOutcome },
  ): Promise<FinalizeReport>;
}

export interface NativeFinalizerDeps {
  readonly checkpoints?: NativeCheckpointPort;
  /** Writes the sidebar entry (`status`, `lastRunEndedAt`) and announces the change. */
  readonly publish: (thread: NativeThreadRef, status: ConversationStatus) => Promise<void>;
}

const TAKES_CHECKPOINT_AFTER: readonly SettleOutcome[] = ["completed", "failed", "cancelled", "interrupted"];

export const statusOfOutcome = (outcome: SettleOutcome): ConversationStatus =>
  outcome === "completed" || outcome === "cancelled" ? "idle" : "error";

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const refusal = (detail: string): PrepareResult => ({
  ok: false,
  reason: `Could not take the checkpoint before the run (${detail}). Nothing was started and your message is kept.`,
});

export function createNativeFinalizer(deps: NativeFinalizerDeps): NativeFinalizer {
  const finalized = new Set<string>();
  const { checkpoints } = deps;

  async function checkpointBefore(threadId: string, requestId: string): Promise<PrepareResult> {
    if (!checkpoints) return { ok: true };
    try {
      if (!(await checkpoints.applies(threadId))) return { ok: true };
      await checkpoints.snapshotBefore(threadId, requestId);
      if (await checkpoints.hasBefore(threadId, requestId)) return { ok: true };
      return refusal("the snapshot was not recorded");
    } catch (error) {
      return refusal(describeError(error));
    }
  }

  async function checkpointAfter(threadId: string, operationId: string): Promise<boolean> {
    if (!checkpoints) return false;
    try {
      if (!(await checkpoints.applies(threadId))) return false;
      await checkpoints.snapshotAfter(threadId, operationId);
      return true;
    } catch (error) {
      console.error("tau: could not take a native checkpoint after a run", error);
      return false;
    }
  }

  async function finalize(
    thread: NativeThreadRef,
    { operationId, outcome }: { readonly operationId: string; readonly outcome: SettleOutcome },
  ): Promise<FinalizeReport> {
    const status = statusOfOutcome(outcome);
    if (finalized.has(operationId)) return { operationId, outcome, duplicate: true, steps: [], status };
    finalized.add(operationId);
    const steps: FinalizeStep[] = [];
    if (TAKES_CHECKPOINT_AFTER.includes(outcome) && (await checkpointAfter(thread.id, operationId))) {
      steps.push("checkpoint-after");
    }
    await deps.publish(thread, status);
    steps.push("index-and-changes");
    return { operationId, outcome, duplicate: false, steps, status };
  }

  return { checkpointBefore, finalize };
}

const unsupportedOnNative = (capability: string): AppError =>
  new AppError("invalid_request", `Native Claude Code threads do not support ${capability} yet.`);

export type IsNative = (threadId: string) => Promise<boolean>;

/** A goal needs a Pi run-end judge that a native thread never has: refuse before any side effect. */
export function refuseGoalsOnNative(goals: Core["goals"], isNative: IsNative): Core["goals"] {
  return {
    ...goals,
    async set(conversationId, condition) {
      if (await isNative(conversationId)) throw unsupportedOnNative("goals");
      return goals.set(conversationId, condition);
    },
  };
}

/** A loop is a Pi timer that submits Pi input to the thread: refuse before any side effect. */
export function refuseLoopsOnNative(timers: Core["timers"], isNative: IsNative): Core["timers"] {
  return {
    ...timers,
    async loop(conversationId, options) {
      if (await isNative(conversationId)) throw unsupportedOnNative("loops");
      return timers.loop(conversationId, options);
    },
  };
}
