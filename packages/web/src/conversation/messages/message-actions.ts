import type { ReactNode } from "react";
import { useCheckpointActions } from "../checkpoints/use-checkpoint-actions";

export interface MessageEntry {
  conversationId: string;
  entryId: string;
  role: "user" | "assistant";
  text: string;
}

export interface MessageAction {
  id: string;
  label: string;
  destructive?: boolean;
  onSelect(): void;
}

export interface MessageActions {
  actions: MessageAction[];
  overlays: ReactNode;
}

export function useMessageActions(entry: MessageEntry): MessageActions {
  const sources = [useCheckpointActions(entry)];
  return {
    actions: sources.flatMap((source) => source.actions),
    overlays: sources.map((source) => source.overlays),
  };
}
