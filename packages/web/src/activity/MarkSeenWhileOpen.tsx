import { useEffect } from "react";
import { preferences } from "@/lib/preferences";
import { useAllConversations } from "@/lib/queries";
import { useNodeId } from "@/nodes/node-context";
import { useOpenConversation } from "./use-open-conversation";

export function MarkSeenWhileOpen() {
  const { conversationId } = useOpenConversation();
  const nodeId = useNodeId();
  const summary = useAllConversations().data?.find((conversation) => conversation.id === conversationId);
  const lastRunEndedAt = summary?.lastRunEndedAt ?? 0;

  useEffect(() => {
    if (conversationId)
      preferences.setLastSeenAt(conversationId, Math.max(Date.now(), lastRunEndedAt), nodeId);
  }, [conversationId, lastRunEndedAt, nodeId]);

  return null;
}
