import { useMatch } from "react-router";
import { CONVERSATION_ROUTE, NODE_CONVERSATION_ROUTE } from "@/lib/paths";

export interface OpenConversation {
  /** Absent on the hub's own node (URLs without `/n/<id>`). */
  nodeId?: string;
  projectId?: string;
  conversationId?: string;
}

/** Also matches the pane suffixes: `…/terminal` and `…/terminal/:terminalId`, local and under `/n/:nodeId`. */
export function useOpenConversation(): OpenConversation {
  const local = useMatch({ path: CONVERSATION_ROUTE, end: true })?.params;
  const remote = useMatch({ path: NODE_CONVERSATION_ROUTE, end: true })?.params;
  if (remote !== undefined) {
    return {
      nodeId: remote.nodeId,
      projectId: remote.projectId,
      conversationId: remote.conversationId,
    };
  }
  return local === undefined ? {} : { projectId: local.projectId, conversationId: local.conversationId };
}
