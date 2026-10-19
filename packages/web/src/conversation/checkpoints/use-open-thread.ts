import { useQueryClient } from "@tanstack/react-query";
import type { ConversationSummary } from "@tau/protocol";
import { useNavigate } from "react-router";
import { scopeTarget } from "@/lib/node-keys";
import { conversationPath } from "@/lib/paths";
import { useNodeId } from "@/nodes/node-context";
import { saveDraft } from "../composer/drafts";

/** Opens a thread the server just created, optionally with text waiting in its composer. */
export function useOpenThread() {
  const navigate = useNavigate();
  const nodeId = useNodeId();
  const queryClient = useQueryClient();
  return async (thread: ConversationSummary, draft?: string) => {
    if (draft) saveDraft(scopeTarget(thread.id, nodeId), draft);
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    navigate(conversationPath(thread.projectId, thread.id, nodeId));
  };
}
