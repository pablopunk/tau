import type { Harness } from "@earendil-works/pi-durable";
import type { AgentStatus } from "@tau/protocol";
import type { ConversationStore } from "../../harness/conversation-store";
import { NO_REPORT, type SettledChildOutcome, setNativeChildStatus } from "./native-child";
import type { AwaitedOutcome, NativeService } from "./service";

export const nativeChildRequestId = (parentId: string, callId: string): string =>
  `agent:${parentId}:${callId}`;

export const UNKNOWN_OUTCOME_MESSAGE = "native child outcome unknown; check the workspace";

export type NativeChildCall = {
  readonly parentId: string;
  /** The parent's tool call id: the same call always maps to the same child. */
  readonly callId: string;
  readonly description: string;
  readonly prompt: string;
  readonly signal?: AbortSignal | undefined;
  readonly onStarted?: (childId: string) => Promise<void> | void;
};

export type NativeChildResult =
  | { readonly ok: true; readonly childId: string; readonly status: "done"; readonly text: string }
  | {
      readonly ok: false;
      readonly childId: string;
      readonly status: Extract<AgentStatus, "failed" | "stopped">;
      readonly message: string;
    };

export interface NativeDelegation {
  /** Starts (or finds) the child of this call, waits for its terminal outcome, and cancels it when `signal` aborts. */
  runNativeChild(call: NativeChildCall): Promise<NativeChildResult>;
  isNativeChild(threadId: string): Promise<boolean>;
}

export interface NativeDelegationDeps {
  readonly service: Pick<NativeService, "startChild" | "awaitOperation" | "cancelChild" | "isNative">;
  readonly harness: Harness;
  readonly conversations: Pick<ConversationStore, "find">;
  readonly onChange?: (projectId: string) => void;
  readonly pollMs?: number;
}

const failure = (
  childId: string,
  status: "failed" | "stopped",
  message: string,
): Extract<NativeChildResult, { ok: false }> => ({ ok: false, childId, status, message });

const unknownFailure = (childId: string, reason: string): NativeChildResult =>
  failure(childId, "failed", `${UNKNOWN_OUTCOME_MESSAGE}. Inspect child thread ${childId} (${reason}).`);

/** Anything that is not a verified `completed` is an error; an unknown outcome is never success. */
export function resultOfOutcome(childId: string, outcome: AwaitedOutcome): NativeChildResult {
  switch (outcome.kind) {
    case "completed":
      return { ok: true, childId, status: "done", text: outcome.text || NO_REPORT };
    case "failed":
      return failure(childId, "failed", `Native child ${childId} failed: ${outcome.text}`);
    case "blocked":
      return failure(
        childId,
        "failed",
        `Native child ${childId} did not start: ${outcome.reason}. Its input is kept in that thread.`,
      );
    case "cancelled":
      return failure(childId, "stopped", `Native child ${childId} was cancelled.`);
    case "interrupted":
      return failure(childId, "stopped", `Native child ${childId} was interrupted: ${outcome.reason}.`);
    case "unknown":
      return unknownFailure(childId, outcome.reason);
    case "timed-out":
      return unknownFailure(childId, "the stop could not be verified in time");
    case "wait-stopped":
      return unknownFailure(childId, "waiting stopped before the run settled");
  }
}

const stoppedWithParent = (childId: string): NativeChildResult =>
  failure(childId, "stopped", `Native child ${childId} was cancelled because this call was stopped.`);

const isNeverStartedOrCancelled = (outcome: AwaitedOutcome): outcome is SettledChildOutcome =>
  outcome.kind === "cancelled" || outcome.kind === "blocked" || outcome.kind === "interrupted";

export function createNativeDelegation(deps: NativeDelegationDeps): NativeDelegation {
  const { service } = deps;
  const poll = deps.pollMs === undefined ? {} : { pollMs: deps.pollMs };

  async function recordStatus(childId: string, status: AgentStatus): Promise<void> {
    const child = await deps.conversations.find(childId);
    if (!child) return;
    await setNativeChildStatus(deps.harness, { id: childId, projectId: child.projectId }, status).catch(
      () => false,
    );
    deps.onChange?.(child.projectId);
  }

  async function settle(childId: string, result: NativeChildResult): Promise<NativeChildResult> {
    await recordStatus(childId, result.status);
    return result;
  }

  async function afterParentStopped(childId: string, requestId: string): Promise<NativeChildResult> {
    const outcome = await service.cancelChild(childId, requestId, poll);
    return isNeverStartedOrCancelled(outcome)
      ? stoppedWithParent(childId)
      : resultOfOutcome(childId, outcome);
  }

  async function runNativeChild(call: NativeChildCall): Promise<NativeChildResult> {
    const requestId = nativeChildRequestId(call.parentId, call.callId);
    const { summary } = await service.startChild({
      parentId: call.parentId,
      requestId,
      title: call.description,
      prompt: call.prompt,
    });
    const childId = summary.id;
    await call.onStarted?.(childId);
    const outcome = await service.awaitOperation(childId, requestId, {
      ...poll,
      ...(call.signal && { signal: call.signal }),
    });
    const result =
      outcome.kind === "wait-stopped"
        ? await afterParentStopped(childId, requestId)
        : resultOfOutcome(childId, outcome);
    return settle(childId, result);
  }

  async function isNativeChild(threadId: string): Promise<boolean> {
    const summary = await deps.conversations.find(threadId);
    if (!summary || summary.parentId === null) return false;
    return service.isNative(threadId);
  }

  return { runNativeChild, isNativeChild };
}
