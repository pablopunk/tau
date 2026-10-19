import type { ConversationSummary } from "@tau/protocol";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { conversationPath } from "@/lib/paths";
import { preferences } from "@/lib/preferences";
import { type MachineData, useMachinesData } from "@/machines";
import { findFinishedRuns } from "./find-finished-runs";
import { notificationsGranted } from "./notification-support";

const isVisible = () => document.visibilityState === "visible";
const keyOf = (machine: MachineData) => machine.machineId ?? "local";

/** Run-finished notifications of every reachable machine; the name of the machine is part of the title when several are online. */
export function NotificationWatcher() {
  const machines = useMachinesData();
  const previous = useRef(new Map<string, ConversationSummary[]>());
  const { conversationId: openId, machineId: openMachineId } = useOpenConversation();
  const navigate = useNavigate();

  // biome-ignore lint/correctness/useExhaustiveDependencies: only new data compares against the previous data
  useEffect(() => {
    for (const machine of machines) {
      const before = previous.current.get(keyOf(machine));
      const finished = findFinishedRuns(before, machine.conversations);
      previous.current.set(keyOf(machine), [...machine.conversations]);
      if (!preferences.getNotificationsEnabled() || !notificationsGranted()) continue;
      for (const conversation of finished) {
        if (conversation.id === openId && machine.machineId === openMachineId && isVisible()) continue;
        const title = conversation.title.trim() || "New thread";
        const notification = new Notification(machines.length > 1 ? `${title} · ${machine.name}` : title, {
          body: conversation.status === "error" ? "The run failed." : "The run finished.",
          tag: machine.machineId === undefined ? conversation.id : `${machine.machineId}:${conversation.id}`,
        });
        notification.onclick = () => {
          window.focus();
          navigate(conversationPath(conversation.projectId, conversation.id, machine.machineId));
        };
      }
    }
  }, [machines]);

  return null;
}
