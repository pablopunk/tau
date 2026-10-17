import type { MessageActions, MessageEntry } from "../messages/message-actions";

export function useCheckpointActions(_entry: MessageEntry): MessageActions {
  return { actions: [], overlays: null };
}
