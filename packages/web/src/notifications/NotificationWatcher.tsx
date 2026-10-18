import type { ConversationSummary } from "@tau/protocol";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { conversationPath } from "@/lib/paths";
import { preferences } from "@/lib/preferences";
import { useAllConversations } from "@/lib/queries";
import { findFinishedRuns } from "./find-finished-runs";
import { notificationsGranted } from "./notification-support";

const isVisible = () => document.visibilityState === "visible";

export function NotificationWatcher() {
  const conversations = useAllConversations().data;
  const previous = useRef<ConversationSummary[] | undefined>(undefined);
  const { conversationId: openId } = useOpenConversation();
  const navigate = useNavigate();

  // biome-ignore lint/correctness/useExhaustiveDependencies: only new data compares against the previous data
  useEffect(() => {
    if (!conversations) return;
    const finished = findFinishedRuns(previous.current, conversations);
    previous.current = conversations;
    if (!preferences.getNotificationsEnabled() || !notificationsGranted()) return;
    for (const conversation of finished) {
      if (conversation.id === openId && isVisible()) continue;
      const notification = new Notification(conversation.title.trim() || "New thread", {
        body: conversation.status === "error" ? "The run failed." : "The run finished.",
        tag: conversation.id,
      });
      notification.onclick = () => {
        window.focus();
        navigate(conversationPath(conversation.projectId, conversation.id));
      };
    }
  }, [conversations]);

  return null;
}
