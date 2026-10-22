import { type LiveInfo, type QueuedMessage, readLive } from "./live-info";
import { type NativeEvent, nativeEventsOf } from "./native-events";
import {
  type ExecutorKind,
  executorOf,
  isTerminalLifecycle,
  type RuntimeLifecycle,
  type WriterState,
} from "./runtime";
import type { ConversationView } from "./view";

export interface RuntimeLiveInfo extends LiveInfo {
  readonly executor: ExecutorKind;
  readonly lifecycle: RuntimeLifecycle | undefined;
  readonly writer: WriterState;
}

export type WaitOutcome = "done" | "pending" | "unknown";

const EMPTY_LIVE: LiveInfo = {
  busy: false,
  streaming: undefined,
  retry: undefined,
  slots: [],
  queued: [],
  compacting: false,
};

function readPiRuntimeLive(view: ConversationView): RuntimeLiveInfo {
  const live = readLive(view);
  return {
    ...live,
    executor: "pi",
    lifecycle: live.busy ? "running" : undefined,
    writer: live.busy ? "running" : "settled",
  };
}

const NATIVE_BUSY: readonly RuntimeLifecycle[] = [
  "preparing",
  "ready",
  "starting",
  "running",
  "cancelling",
  "reconciling",
];

const RUNNING_WRITER: readonly RuntimeLifecycle[] = ["accepted", "preparing", "ready", "starting", "running"];

function nativeWriterOf(lifecycle: RuntimeLifecycle | undefined): WriterState {
  if (lifecycle === undefined || lifecycle === "outcome-unknown") return "unknown";
  if (RUNNING_WRITER.includes(lifecycle)) return "running";
  if (lifecycle === "cancelling" || lifecycle === "reconciling") return lifecycle;
  return "settled";
}

function lastLifecycleOf(events: readonly NativeEvent[]): RuntimeLifecycle | undefined {
  const last = events.findLast((event) => event.type === "lifecycle");
  return last?.type === "lifecycle" ? last.lifecycle : undefined;
}

function queuedOf(events: readonly NativeEvent[]): QueuedMessage[] {
  const dispositions = new Map<string, string>();
  for (const event of events)
    if (event.type === "queue") dispositions.set(event.requestId, event.disposition);
  const queued: QueuedMessage[] = [];
  let ordinal = 0;
  for (const event of events) {
    if (event.type !== "user") continue;
    ordinal += 1;
    if (dispositions.get(event.requestId) !== "queued") continue;
    queued.push({ id: ordinal, mode: "followUp", entryKind: "native.user", text: event.text, images: [] });
  }
  return queued;
}

function readNativeRuntimeLive(view: ConversationView, executor: ExecutorKind): RuntimeLiveInfo {
  const events = nativeEventsOf(view);
  const lifecycle = lastLifecycleOf(events);
  return {
    ...EMPTY_LIVE,
    executor,
    lifecycle,
    writer: nativeWriterOf(lifecycle),
    busy: lifecycle !== undefined && NATIVE_BUSY.includes(lifecycle),
    queued: queuedOf(events),
  };
}

export function readRuntimeLive(view: ConversationView, executor: ExecutorKind | undefined): RuntimeLiveInfo {
  const kind = executorOf({ executor });
  return kind === "pi" ? readPiRuntimeLive(view) : readNativeRuntimeLive(view, kind);
}

function hasSettledLifecycle(lifecycle: RuntimeLifecycle | undefined): boolean {
  return lifecycle === undefined || isTerminalLifecycle(lifecycle);
}

export function isThreadIdle(info: RuntimeLiveInfo): boolean {
  return info.writer === "settled" && hasSettledLifecycle(info.lifecycle);
}

export function waitOutcomeOf(info: RuntimeLiveInfo): WaitOutcome {
  if (info.writer === "unknown" || info.lifecycle === "outcome-unknown") return "unknown";
  return isThreadIdle(info) ? "done" : "pending";
}
