import type { ConversationSummary, RuntimeLifecycle, WriterState } from "@tau/protocol";
import type { StoreInspection } from "../../harness/runtime-store";

export type WriterInspection = Pick<StoreInspection, "lifecycle" | "cancelsInFlight">;

const RUNNING_LIFECYCLES: readonly RuntimeLifecycle[] = [
  "accepted",
  "preparing",
  "ready",
  "starting",
  "running",
];

/** Mirrors `readRuntimeLive`; an acknowledged unknown outcome stays unknown (the store never records a verified death). */
export function writerStateOfInspection({ lifecycle, cancelsInFlight }: WriterInspection): WriterState {
  if (lifecycle === undefined || lifecycle === "outcome-unknown") return "unknown";
  if (cancelsInFlight > 0 || lifecycle === "cancelling") return "cancelling";
  if (lifecycle === "reconciling") return "reconciling";
  if (RUNNING_LIFECYCLES.includes(lifecycle)) return "running";
  return "settled";
}

export const stillPumping = (state: WriterState, pumping: boolean): WriterState =>
  state === "settled" && pumping ? "running" : state;

export interface NativeWriterSource {
  isNative(threadId: string): Promise<boolean>;
  writerStateOf(threadId: string): Promise<WriterState>;
}

/** `undefined` means not a native thread. */
export function nativeWriterPort(
  native: () => NativeWriterSource | undefined,
): (thread: ConversationSummary) => Promise<WriterState | undefined> {
  return async (thread) => {
    const source = native();
    if (!source) return "unknown";
    return (await source.isNative(thread.id)) ? source.writerStateOf(thread.id) : undefined;
  };
}
