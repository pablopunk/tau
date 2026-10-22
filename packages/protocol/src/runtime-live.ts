import { type LiveInfo, readLive } from "./live-info";
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

function readNativeRuntimeLive(executor: ExecutorKind): RuntimeLiveInfo {
  return { ...EMPTY_LIVE, executor, lifecycle: undefined, writer: "unknown" };
}

export function readRuntimeLive(view: ConversationView, executor: ExecutorKind | undefined): RuntimeLiveInfo {
  const kind = executorOf({ executor });
  return kind === "pi" ? readPiRuntimeLive(view) : readNativeRuntimeLive(kind);
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
