import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { conversationPath } from "@/lib/paths";
import { type MachineData, useMachinesData } from "@/machines";

export interface ThreadRef {
  machineId: string | undefined;
  projectId: string;
  id: string;
}

/** Active threads of every machine, most recently active first: the order of the sidebar's thread list. */
export function threadOrder(machines: readonly MachineData[]): ThreadRef[] {
  return machines
    .flatMap((machine) =>
      machine.conversations
        .filter((conversation) => conversation.archivedAt === null)
        .map((conversation) => ({
          ref: { machineId: machine.machineId, projectId: conversation.projectId, id: conversation.id },
          at: conversation.lastActivityAt,
        })),
    )
    .sort((a, b) => b.at - a.at)
    .map(({ ref }) => ref);
}

/** The thread `delta` steps from the open one, wrapping around. Without an open thread: the first (or last). */
export function adjacentThread(order: readonly ThreadRef[], current: ThreadRef | undefined, delta: 1 | -1) {
  if (order.length === 0) return undefined;
  const index = order.findIndex(
    (thread) => thread.id === current?.id && thread.machineId === current?.machineId,
  );
  if (index === -1) return delta === 1 ? order[0] : order.at(-1);
  return order[(index + delta + order.length) % order.length];
}

export function useAdjacentThread() {
  const navigate = useNavigate();
  const open = useOpenConversation();
  const order = threadOrder(useMachinesData());
  const current = open.conversationId
    ? { machineId: open.machineId, projectId: open.projectId ?? "", id: open.conversationId }
    : undefined;
  const go = (delta: 1 | -1) => {
    const target = adjacentThread(order, current, delta);
    if (target) navigate(conversationPath(target.projectId, target.id, target.machineId));
  };
  return { go, available: order.length > 1 };
}
