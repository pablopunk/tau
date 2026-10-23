import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { conversationPath } from "@/lib/paths";
import { type NodeData, useNodesData } from "@/nodes";

export interface ThreadRef {
  nodeId: string | undefined;
  projectId: string;
  id: string;
  hasWorktree: boolean;
}

/** Active threads of every node, most recently active first: the order of the sidebar's thread list. */
export function threadOrder(nodes: readonly NodeData[]): ThreadRef[] {
  return nodes
    .flatMap((node) =>
      node.conversations
        .filter((conversation) => conversation.archivedAt === null)
        .map((conversation) => ({
          ref: {
            nodeId: node.nodeId,
            projectId: conversation.projectId,
            id: conversation.id,
            hasWorktree:
              conversation.workspace.mode === "worktree" && conversation.workspace.state !== "removed",
          },
          at: conversation.lastActivityAt,
        })),
    )
    .sort((a, b) => b.at - a.at)
    .map(({ ref }) => ref);
}

/** The thread `delta` steps from the open one, wrapping around. Without an open thread: the first (or last). */
export function adjacentThread(
  order: readonly ThreadRef[],
  current: Pick<ThreadRef, "id" | "nodeId"> | undefined,
  delta: 1 | -1,
) {
  if (order.length === 0) return undefined;
  const index = order.findIndex((thread) => thread.id === current?.id && thread.nodeId === current?.nodeId);
  if (index === -1) return delta === 1 ? order[0] : order.at(-1);
  return order[(index + delta + order.length) % order.length];
}

export function useAdjacentThread() {
  const navigate = useNavigate();
  const open = useOpenConversation();
  const order = threadOrder(useNodesData());
  const current = open.conversationId
    ? { nodeId: open.nodeId, projectId: open.projectId ?? "", id: open.conversationId }
    : undefined;
  const go = (delta: 1 | -1) => {
    const target = adjacentThread(order, current, delta);
    if (target) navigate(conversationPath(target.projectId, target.id, target.nodeId));
  };
  const neighbors = ([1, -1] as const).flatMap((delta) => adjacentThread(order, current, delta) ?? []);
  return { go, available: order.length > 1, neighbors };
}
