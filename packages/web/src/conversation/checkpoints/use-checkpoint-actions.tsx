import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import type { MessageAction, MessageActions, MessageEntry } from "../messages/message-actions";
import { RewindDialog } from "./RewindDialog";
import { useOpenThread } from "./use-open-thread";

export function useCheckpointActions(entry: MessageEntry): MessageActions {
  const [rewindOpen, setRewindOpen] = useState(false);
  const openThread = useOpenThread();
  const isUserMessage = entry.role === "user";

  const fork = () =>
    api.conversations
      .fork(entry.conversationId, entry.entryId)
      .then((thread) => openThread(thread))
      .catch((error: unknown) => toast.error(errorMessage(error)));

  const actions: MessageAction[] = [{ id: "fork", label: "Fork from here", onSelect: fork }];
  if (isUserMessage) {
    actions.push({
      id: "rewind",
      label: "Rewind to here",
      destructive: true,
      onSelect: () => setRewindOpen(true),
    });
  }
  return {
    actions,
    overlays: isUserMessage ? (
      <RewindDialog key="rewind" entry={entry} open={rewindOpen} onOpenChange={setRewindOpen} />
    ) : null,
  };
}
