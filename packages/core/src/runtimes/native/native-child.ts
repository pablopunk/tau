import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import type { AgentStatus } from "@tau/protocol";
import { updateLiveConversation } from "../../harness/conversation-index";
import type { NativeThreadRef } from "../../harness/conversation-native";
import type { RuntimeStore } from "../../harness/runtime-store";
import type { NativeEvent } from "./events";

export const NATIVE_AGENT_TYPE = "claude-code";

export const NO_REPORT = "The subagent finished without a report.";

export type ChildOutcome =
  | { readonly kind: "pending" }
  | { readonly kind: "completed"; readonly text: string }
  | { readonly kind: "failed"; readonly text: string }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "interrupted"; readonly reason: string }
  | { readonly kind: "unknown"; readonly reason: string };

export type SettledChildOutcome = Exclude<ChildOutcome, { kind: "pending" }>;

type TextEvent = Extract<NativeEvent, { type: "assistant-text" }>;

export type NativeChildIdentity = { readonly parentId: string; readonly title: string };

/** Idempotent: a replay re-applies the same parent and title and keeps a status already recorded. */
export function markNativeChild(
  harness: Harness,
  thread: NativeThreadRef,
  identity: NativeChildIdentity,
): Promise<boolean> {
  return updateLiveConversation(
    harness,
    Number(thread.id) as ConversationId,
    thread.projectId,
    (meta, entry) => {
      meta.title = identity.title;
      meta.titleSource = "user";
      entry.title = identity.title;
      entry.parentId = identity.parentId;
      entry.agentType = NATIVE_AGENT_TYPE;
      entry.agentStatus ??= "running";
      entry.background = false;
      return true;
    },
  );
}

export function setNativeChildStatus(
  harness: Harness,
  thread: NativeThreadRef,
  status: AgentStatus,
): Promise<boolean> {
  return updateLiveConversation(
    harness,
    Number(thread.id) as ConversationId,
    thread.projectId,
    (_meta, entry) => {
      entry.agentStatus = status;
      return true;
    },
  );
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

const isText = (event: NativeEvent): event is TextEvent => event.type === "assistant-text";

function lastMessageText(events: readonly NativeEvent[]): string | undefined {
  const texts = events.filter(isText).filter((event) => event.text.trim());
  const last = texts.at(-1);
  if (!last) return undefined;
  return texts
    .filter((event) => event.messageId === last.messageId)
    .map((event) => event.text.trim())
    .join("\n");
}

function successfulResultText(events: readonly NativeEvent[]): string | undefined {
  const result = events.findLast((event) => event.type === "result" && !event.isError);
  return result?.type === "result" ? result.text?.trim() : undefined;
}

/** The delegated request is the child's first and only run, so the whole event log belongs to it. */
export const answerOfDelegatedRun = (events: readonly NativeEvent[]): string =>
  lastMessageText(events) ?? successfulResultText(events) ?? "";

function failureTextOfDelegatedRun(events: readonly NativeEvent[], reason?: string): string {
  const failed = events.findLast((event) => event.type === "result" && event.isError);
  if (failed?.type === "result") return oneLine(failed.text ?? failed.subtype);
  return reason ?? "the run failed";
}

function blockedReasonOf(events: readonly NativeEvent[]): string {
  const blocked = events.findLast((event) => event.type === "notice" && event.code === "blocked");
  if (blocked?.type !== "notice") return "the run could not start";
  return oneLine(blocked.text.replace(/^Run not started:\s*/, ""));
}

function terminalOutcome(
  lifecycle: string,
  events: readonly NativeEvent[],
  reason: string | undefined,
): ChildOutcome {
  switch (lifecycle) {
    case "completed":
      return { kind: "completed", text: answerOfDelegatedRun(events) };
    case "failed":
      return { kind: "failed", text: failureTextOfDelegatedRun(events, reason) };
    case "cancelled":
      return { kind: "cancelled" };
    case "interrupted":
      return {
        kind: "interrupted",
        reason: reason ?? "the process went away before the prompt was delivered",
      };
    default:
      return { kind: "unknown", reason: reason ?? "the run's outcome could not be verified" };
  }
}

export type RequestDisposition = "queued" | "delivered" | "cancelled" | undefined;

const isQueuedAndBlocked = (disposition: RequestDisposition, lifecycle: string | undefined): boolean =>
  disposition === "queued" && lifecycle === "blocked";

/**
 * The outcome of the one run that delivered `requestId`. Read-only and gate-free. Never `completed` unless that
 * exact run settled `completed`; a request whose run is no longer the current operation is `unknown`.
 */
export async function readChildOutcome(
  store: RuntimeStore,
  requestId: string,
  disposition: RequestDisposition,
): Promise<ChildOutcome> {
  if (disposition === "cancelled") return { kind: "cancelled" };
  const state = await store.operationState();
  const events = (await store.events()).map((entry) => entry.event);
  if (isQueuedAndBlocked(disposition, state.lifecycle))
    return { kind: "blocked", reason: blockedReasonOf(events) };
  if (disposition !== "delivered") return { kind: "pending" };
  const { operation } = state;
  if (operation?.deliveredRequestId !== requestId) {
    return { kind: "unknown", reason: "the delegated run is no longer the thread's current operation" };
  }
  if (!operation.terminal) return { kind: "pending" };
  return terminalOutcome(operation.terminal.lifecycle, events, operation.terminal.reason);
}
