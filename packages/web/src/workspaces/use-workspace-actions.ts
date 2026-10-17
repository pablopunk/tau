import { isAppError } from "@pi-everywhere/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { newRequestId } from "@/conversation/use-conversation-actions";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/queries";

export interface WorkspaceFailure {
  code: string | null;
  message: string;
}

export function useWorkspaceActions(conversationId: string) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<WorkspaceFailure | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace(conversationId) });
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setPending(true);
    setFailure(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (caught) {
      setFailure({ code: isAppError(caught) ? caught.code : null, message: errorMessage(caught) });
      return false;
    } finally {
      setPending(false);
    }
  };

  const sendMessage = (text: string) =>
    run(() => api.conversations.send(conversationId, { text, requestId: newRequestId() }));

  return {
    failure,
    pending,
    dismiss: () => setFailure(null),
    merge: () => run(() => api.workspaces.merge(conversationId)),
    createPullRequest: () => run(() => api.workspaces.createPullRequest(conversationId)),
    remove: (force: boolean) => run(() => api.workspaces.remove(conversationId, force)),
    sendMessage,
  };
}
