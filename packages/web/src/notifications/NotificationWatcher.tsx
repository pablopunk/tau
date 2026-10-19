import type { ConversationSummary } from "@tau/protocol";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { conversationPath } from "@/lib/paths";
import { preferences } from "@/lib/preferences";
import { type NodeData, useNodesData } from "@/nodes";
import { findFinishedRuns } from "./find-finished-runs";
import { notificationsGranted } from "./notification-support";

const isVisible = () => document.visibilityState === "visible";
const keyOf = (node: NodeData) => node.nodeId ?? "local";

/** Run-finished notifications of every reachable node; the name of the node is part of the title when several are online. */
export function NotificationWatcher() {
  const nodes = useNodesData();
  const previous = useRef(new Map<string, ConversationSummary[]>());
  const { conversationId: openId, nodeId: openNodeId } = useOpenConversation();
  const navigate = useNavigate();

  // biome-ignore lint/correctness/useExhaustiveDependencies: only new data compares against the previous data
  useEffect(() => {
    for (const node of nodes) {
      const before = previous.current.get(keyOf(node));
      const finished = findFinishedRuns(before, node.conversations);
      previous.current.set(keyOf(node), [...node.conversations]);
      if (!preferences.getNotificationsEnabled() || !notificationsGranted()) continue;
      for (const conversation of finished) {
        if (conversation.id === openId && node.nodeId === openNodeId && isVisible()) continue;
        const title = conversation.title.trim() || "New thread";
        const notification = new Notification(nodes.length > 1 ? `${title} · ${node.name}` : title, {
          body: conversation.status === "error" ? "The run failed." : "The run finished.",
          tag: node.nodeId === undefined ? conversation.id : `${node.nodeId}:${conversation.id}`,
        });
        notification.onclick = () => {
          window.focus();
          navigate(conversationPath(conversation.projectId, conversation.id, node.nodeId));
        };
      }
    }
  }, [nodes]);

  return null;
}
