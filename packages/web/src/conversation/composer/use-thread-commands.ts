import { useQueryClient } from "@tanstack/react-query";
import { isAppError } from "@tau/protocol";
import { type RefObject, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { PickersHandle } from "@/components/ModelThinkingPickers";
import { runGoalCommand } from "@/goal/goal-command";
import { errorMessage } from "@/lib/error-message";
import { newThreadPath } from "@/lib/paths";
import { useApi, useMachineId } from "@/machines/machine-context";
import { LOOP_USAGE, parseLoopArgs } from "@/timers/loop-args";
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
  const machineId = useMachineId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);

  const commands = useMemo<CommandHandlers>(() => {
    const refreshLists = () => queryClient.invalidateQueries({ queryKey: ["conversations"] });
    return {
      compact: (instructions) =>
        api.conversations
          .compact(conversationId, instructions ? { instructions } : {})
          .catch((error: unknown) => void toast.error(compactFailureMessage(error))),
      new: () => void navigate(newThreadPath(projectId, machineId)),
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
        await api.conversations.archive(conversationId, true);
        await refreshLists();
        navigate("/");
      },
    };
  }, [api, machineId, conversationId, projectId, pickers, navigate, queryClient]);

  const rename = async (title: string) => {
    await api.conversations.rename(conversationId, title);
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  return { commands, renaming, closeRename: () => setRenaming(false), rename };
}
