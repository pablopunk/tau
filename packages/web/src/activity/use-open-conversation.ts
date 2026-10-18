import { useMatch } from "react-router";
import { CONVERSATION_ROUTE, MACHINE_CONVERSATION_ROUTE } from "@/lib/paths";

export interface OpenConversation {
  /** Absent on the hub's own machine (URLs without `/m/<id>`). */
  machineId?: string;
  projectId?: string;
  conversationId?: string;
}

/** Also matches the pane suffixes: `…/terminal` and `…/terminal/:terminalId`, local and under `/m/:machineId`. */
export function useOpenConversation(): OpenConversation {
  const local = useMatch({ path: CONVERSATION_ROUTE, end: true })?.params;
  const remote = useMatch({ path: MACHINE_CONVERSATION_ROUTE, end: true })?.params;
  if (remote !== undefined) {
    return {
      machineId: remote.machineId,
      projectId: remote.projectId,
      conversationId: remote.conversationId,
    };
  }
  return local === undefined ? {} : { projectId: local.projectId, conversationId: local.conversationId };
}
