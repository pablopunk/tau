import { useQueryClient } from "@tanstack/react-query";
import { isAppError } from "@tau/protocol";
import { type RefObject, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { PickersHandle } from "@/components/ModelThinkingPickers";
import { runGoalCommand } from "@/goal/goal-command";
import { errorMessage } from "@/lib/error-message";
import { newThreadPath } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { useApi, useNodeId } from "@/nodes/node-context";
import { LOOP_USAGE, parseLoopArgs } from "@/timers/loop-args";
import { useThreadListMutation } from "../queue/thread-list-mutations";
import type { CommandHandlers } from "./slash-commands";

export interface ThreadCommandsInput {
  conversationId: string;
  projectId: string | undefined;
  pickers: RefObject<PickersHandle | null>;
}

export function compactFailureMessage(error: unknown): string {
  return isAppError(error) && error.code === "nothing_to_compact"
    ? "Nothing to compact yet"
    : errorMessage(error);
}

export function useThreadCommands({ conversationId, projectId, pickers }: ThreadCommandsInput) {
  const api = useApi();
  const nodeId = useNodeId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  // The thread leaves or renames in the lists at the tap; a refusal puts it back and says why.
  const listKeys = [...(projectId ? [queryKeys.conversations(projectId)] : []), queryKeys.allConversations];
  const archiveMutation = useThreadListMutation({
    listKeys,
    mutationFn: () => api.conversations.archive(conversationId, true),
    transform: (list) =>
      list.map((item) => (item.id === conversationId ? { ...item, archivedAt: Date.now() } : item)),
  });
  const renameMutation = useThreadListMutation({
    listKeys,
    mutationFn: (title: string) => api.conversations.rename(conversationId, title),
    transform: (list, title) => list.map((item) => (item.id === conversationId ? { ...item, title } : item)),
  });

  const commands = useMemo<CommandHandlers>(() => {
    const refreshLists = () => queryClient.invalidateQueries({ queryKey: ["conversations"] });
    return {
      compact: (instructions) =>
        api.conversations
          .compact(conversationId, instructions ? { instructions } : {})
          .catch((error: unknown) => void toast.error(compactFailureMessage(error))),
      new: () => void navigate(newThreadPath(projectId, nodeId)),
      model: () => pickers.current?.openModel(),
      thinking: () => pickers.current?.openThinking(),
      rename: () => setRenaming(true),
      goal: (args) => runGoalCommand(api, conversationId, args, queryClient),
      loop: async (args) => {
        const command = parseLoopArgs(args);
        if (command.action === "usage") throw new Error(LOOP_USAGE);
        if (command.action === "stop") await api.timers.stopLoop(conversationId);
        else await api.timers.loop(conversationId, command.input);
        await refreshLists();
      },
      archive: async () => {
        archiveMutation.mutate();
        navigate("/");
      },
    };
  }, [api, nodeId, conversationId, projectId, pickers, navigate, queryClient, archiveMutation.mutate]);

  const rename = async (title: string) => {
    renameMutation.mutate(title);
  };

  return { commands, renaming, closeRename: () => setRenaming(false), rename };
}
