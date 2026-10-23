import { isTerminalLifecycle, type RuntimeLifecycle, type WriterState } from "@tau/protocol";

const WRITER_STATE_PRIORITY: readonly WriterState[] = ["unknown", "running", "cancelling", "reconciling"];

export function combineWriterStates(states: readonly WriterState[]): WriterState {
  return WRITER_STATE_PRIORITY.find((state) => states.includes(state)) ?? "settled";
}

const LEGAL_TRANSITIONS: Readonly<Record<RuntimeLifecycle, readonly RuntimeLifecycle[]>> = {
  accepted: ["preparing"],
  preparing: ["ready", "blocked", "failed", "cancelling"],
  ready: ["starting", "cancelling"],
  starting: ["running", "blocked", "failed", "cancelling"],
  running: ["completed", "failed", "cancelling"],
  blocked: ["preparing", "cancelled", "failed"],
  cancelling: ["cancelled", "interrupted", "outcome-unknown"],
  reconciling: ["running", "completed", "failed", "interrupted", "outcome-unknown", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: [],
  "outcome-unknown": [],
};

function isRestartIntoReconciling(from: RuntimeLifecycle, to: RuntimeLifecycle, restart: boolean): boolean {
  return restart && to === "reconciling" && from !== "reconciling" && !isTerminalLifecycle(from);
}

export function nextLifecycle(
  from: RuntimeLifecycle,
  to: RuntimeLifecycle,
  options: { restart?: boolean } = {},
): boolean {
  if (isRestartIntoReconciling(from, to, options.restart === true)) return true;
  return LEGAL_TRANSITIONS[from].includes(to);
}

export type SettleResult =
  | { ok: true; lifecycle: RuntimeLifecycle }
  | { ok: false; reason: "already-terminal" | "not-terminal-outcome" };

export function settleOperation(
  current: RuntimeLifecycle | undefined,
  outcome: RuntimeLifecycle,
): SettleResult {
  if (current !== undefined && isTerminalLifecycle(current)) return { ok: false, reason: "already-terminal" };
  if (!isTerminalLifecycle(outcome)) return { ok: false, reason: "not-terminal-outcome" };
  return { ok: true, lifecycle: outcome };
}
