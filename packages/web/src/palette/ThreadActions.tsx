import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { errorMessage } from "@/lib/error-message";
import { conversationPath, terminalPath } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { useApi, useMachineId } from "@/machines/machine-context";
import { useOpenAndFocusTerminal, useTerminals, useTerminalsAvailable } from "@/panes/use-terminals";

interface ThreadActionsProps {
  projectId: string;
  conversationId: string;
  archived: boolean;
  run: (action: () => void) => () => void;
}

/** Actions on the open thread. Must render under that thread's machine provider. */
export function ThreadActions({ projectId, conversationId, archived, run }: ThreadActionsProps) {
  const api = useApi();
  const machineId = useMachineId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const available = useTerminalsAvailable().data === true;
  const terminals = useTerminals(conversationId, available).data ?? [];
  const openTerminal = useOpenAndFocusTerminal(projectId, conversationId);

  const attempt = (action: () => Promise<unknown>) => () =>
    void action().catch((error) => toast.error(errorMessage(error)));
  const toggleArchive = async () => {
    await api.conversations.archive(conversationId, !archived);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.allConversations }),
    ]);
  };

  return (
    <CommandGroup heading="This thread">
      {available ? <CommandItem onSelect={run(openTerminal.run)}>New terminal</CommandItem> : null}
      {terminals.map((terminal, index) => (
        <CommandItem
          key={terminal.id}
          value={`terminal ${index + 1} ${terminal.title} ${terminal.id}`}
          onSelect={run(() => navigate(terminalPath(projectId, conversationId, terminal.id, machineId)))}
        >
          Go to terminal: {terminal.title}
        </CommandItem>
      ))}
      {terminals.length > 0 ? (
        <CommandItem onSelect={run(() => navigate(conversationPath(projectId, conversationId, machineId)))}>
          Go to chat
        </CommandItem>
      ) : null}
      <CommandItem onSelect={run(attempt(() => api.conversations.abort(conversationId)))}>
        Stop agent
      </CommandItem>
      <CommandItem onSelect={run(attempt(toggleArchive))}>
        {archived ? "Unarchive thread" : "Archive thread"}
      </CommandItem>
    </CommandGroup>
  );
}
