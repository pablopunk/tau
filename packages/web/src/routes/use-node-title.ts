import { useEffect } from "react";
import { useAllConversations } from "@/lib/queries";
import { useNodeId } from "@/nodes/node-context";
import { useNodeName } from "@/nodes/use-node-name";

/** The window title: the thread, and the node when more than one node is online. */
export function useNodeTitle(conversationId: string) {
  const title = useAllConversations().data?.find((thread) => thread.id === conversationId)?.title;
  const nodeName = useNodeName(useNodeId());
  useEffect(() => {
    const parts = [title, nodeName, "tau"].filter(Boolean);
    document.title = parts.join(" · ");
    return () => {
      document.title = "tau";
    };
  }, [title, nodeName]);
}
