import type { JsonValue } from "@earendil-works/chord";
import type { ConversationView, Op } from "./view";

/** A base frame: the whole view replaces whatever the client had. */
export function baseOps(view: ConversationView): readonly Op[] {
  return [["r", view as unknown as JsonValue]];
}

/** The frame that says the conversation's view is gone. */
export const RETIRED_OPS: readonly Op[] = [["r", null]];

export function isBaseOps(ops: readonly Op[]): boolean {
  return ops[0]?.[0] === "r";
}

export function isRetiredOps(ops: readonly Op[]): boolean {
  return ops.length === 1 && ops[0]?.[0] === "r" && ops[0][1] === null;
}
