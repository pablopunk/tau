import { useEffect } from "react";
import { useAllConversations } from "@/lib/queries";
import { useMachineId } from "@/machines/machine-context";
import { useMachineName } from "@/machines/use-machine-name";

/** The window title: the thread, and the machine when more than one machine is online. */
export function useMachineTitle(conversationId: string) {
  const title = useAllConversations().data?.find((thread) => thread.id === conversationId)?.title;
  const machineName = useMachineName(useMachineId());
  useEffect(() => {
    const parts = [title, machineName, "tau"].filter(Boolean);
    document.title = parts.join(" · ");
    return () => {
      document.title = "tau";
    };
  }, [title, machineName]);
}
