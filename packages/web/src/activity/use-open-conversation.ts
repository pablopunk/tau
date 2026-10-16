import { useMatch } from "react-router";

export function useOpenConversation(): { projectId?: string; conversationId?: string } {
  return useMatch("/p/:projectId/c/:conversationId")?.params ?? {};
}
