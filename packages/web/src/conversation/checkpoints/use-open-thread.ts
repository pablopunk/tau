import { useQueryClient } from "@tanstack/react-query";
import type { ConversationSummary } from "@tau/protocol";
import { useNavigate } from "react-router";
import { conversationPath } from "@/lib/paths";
import { saveDraft } from "../composer/drafts";

/** Opens a thread the server just created, optionally with text waiting in its composer. */
export function useOpenThread() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async (thread: ConversationSummary, draft?: string) => {
    if (draft) saveDraft(thread.id, draft);
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    navigate(conversationPath(thread.projectId, thread.id));
  };
}
