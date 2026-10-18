import { useMatch } from "react-router";

/** Also matches the pane suffixes: `…/terminal` and `…/terminal/:terminalId`. */
export function useOpenConversation(): { projectId?: string; conversationId?: string } {
  const params = useMatch({ path: "/p/:projectId/c/:conversationId/*", end: true })?.params;
  return params === undefined ? {} : { projectId: params.projectId, conversationId: params.conversationId };
}
