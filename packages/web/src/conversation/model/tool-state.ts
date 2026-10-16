import type { ToolCall, ToolSlot } from "@pi-everywhere/protocol";
import type { ToolResultInfo } from "./transcript";

/** `interrupted`: the call has no result and nothing is running it (a stopped or crashed run). */
export type ToolStatus = "pending" | "running" | "done" | "error" | "interrupted";

export interface ToolCallState {
  readonly call: ToolCall;
  readonly status: ToolStatus;
  readonly result: ToolResultInfo | undefined;
  readonly slot: ToolSlot | undefined;
}

export interface ToolLookup {
  readonly results: ReadonlyMap<string, ToolResultInfo>;
  readonly slots: readonly ToolSlot[];
  readonly busy: boolean;
}

function statusOf(result: ToolResultInfo | undefined, slot: ToolSlot | undefined, busy: boolean): ToolStatus {
  if (result) return result.message.isError ? "error" : "done";
  if (slot) return slot.status === "done" ? "done" : slot.status;
  return busy ? "pending" : "interrupted";
}

export function resolveToolCall(call: ToolCall, lookup: ToolLookup): ToolCallState {
  const result = lookup.results.get(call.id);
  const slot = lookup.slots.find((candidate) => candidate.callId === call.id);
  return { call, status: statusOf(result, slot, lookup.busy), result, slot };
}

export function isActive(status: ToolStatus): boolean {
  return status === "pending" || status === "running";
}

export function argText(state: ToolCallState, name: string): string | undefined {
  const value = state.call.arguments?.[name];
  return typeof value === "string" ? value : undefined;
}

/** Text of the result, without the harness's own `<harness>` notes. */
export function resultText(result: ToolResultInfo | undefined): string {
  if (!result) return "";
  return result.message.content
    .flatMap((block) => (block.type === "text" && !block.text.startsWith("<harness>") ? [block.text] : []))
    .join("");
}

export function resultDetails(state: ToolCallState): Record<string, unknown> {
  const details = state.result?.message.details ?? state.slot?.details;
  return details && typeof details === "object" ? (details as Record<string, unknown>) : {};
}

export function exitCodeOf(result: ToolResultInfo | undefined): number | undefined {
  const diagnostic = result?.diagnostics.find((item) => item.code === "exit_code");
  const match = diagnostic?.message.match(/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

export function wasAborted(result: ToolResultInfo | undefined): boolean {
  return result?.diagnostics.some((item) => item.code === "aborted") ?? false;
}
