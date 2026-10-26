import type { ReactNode } from "react";
import { useCheckpointActions } from "../checkpoints/use-checkpoint-actions";

export interface MessageEntry {
  conversationId: string;
  entryId: string;
  role: "user" | "assistant";
  text: string;
  startsConversation?: boolean;
}

/** Entries are rebuilt on every render of the transcript, so rows compare them by value. */
export function sameEntry(a: MessageEntry | undefined, b: MessageEntry | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.conversationId === b.conversationId &&
    a.entryId === b.entryId &&
    a.role === b.role &&
    a.text === b.text &&
    a.startsConversation === b.startsConversation
  );
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
