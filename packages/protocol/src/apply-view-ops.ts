import { applyImmutable } from "@earendil-works/chord/delta";
import { isBaseOps } from "./ops";
import type { ConversationView, Op } from "./view";

/** `undefined`: no base yet. `null`: the view is retired or the conversation is gone. */
export type ViewState = ConversationView | null | undefined;

/** Deltas only make sense on top of a live view; a base frame (`r`) is accepted anywhere. Throws on a bad op. */
export function nextViewState(current: ViewState, ops: readonly Op[]): ViewState {
  const hasBase = current !== undefined && current !== null;
  if (!hasBase && !isBaseOps(ops)) return current;
  return applyImmutable<ConversationView | null>(current, ops);
}
