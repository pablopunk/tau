import { useQueryClient } from "@tanstack/react-query";
import { isAppError } from "@tau/protocol";
import { type RefObject, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { PickersHandle } from "@/components/ModelThinkingPickers";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { newThreadPath } from "@/lib/paths";
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
      new: () => void navigate(newThreadPath(projectId)),
      model: () => pickers.current?.openModel(),
      thinking: () => pickers.current?.openThinking(),
      rename: () => setRenaming(true),
      archive: async () => {
        await api.conversations.archive(conversationId, true);
        await refreshLists();
        navigate("/");
      },
    };
  }, [conversationId, projectId, pickers, navigate, queryClient]);

  const rename = async (title: string) => {
    await api.conversations.rename(conversationId, title);
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  return { commands, renaming, closeRename: () => setRenaming(false), rename };
}
