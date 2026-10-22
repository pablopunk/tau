import { readRuntimeLive } from "@tau/protocol";
import { useNavigate } from "react-router";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { stopAndRestore } from "@/conversation/queue/stop-restore";
import { useThreadListMutation } from "@/conversation/queue/thread-list-mutations";
import { useConversationView } from "@/conversation/use-conversation-view";
import { conversationPath, terminalPath } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { useApi, useNodeId } from "@/nodes/node-context";
import { useOpenAndFocusTerminal, useTerminals, useTerminalsAvailable } from "@/panes/use-terminals";
import { attempt } from "./attempt";
import { useThreadAgent } from "./use-thread-agent";

interface ThreadActionsProps {
  projectId: string;
  conversationId: string;
  archived: boolean;
  onChangeModel: () => void;
  onChangeThinking: () => void;
  run: (action: () => void) => () => void;
}

/** Actions on the open thread. Must render under that thread's node provider. */
export function ThreadActions({
  projectId,
  conversationId,
  archived,
  onChangeModel,
  onChangeThinking,
  run,
}: ThreadActionsProps) {
  const api = useApi();
  const nodeId = useNodeId();
  const navigate = useNavigate();
  const available = useTerminalsAvailable().data === true;
  const terminals = useTerminals(conversationId, available).data ?? [];
  const canThink = useThreadAgent(conversationId).model?.thinkingLevels.some((level) => level !== "off");
  const openTerminal = useOpenAndFocusTerminal(projectId, conversationId);
  const state = useConversationView(conversationId);
  const queued = state.status === "ready" ? readRuntimeLive(state.view, undefined).queued : [];
  const stop = () => stopAndRestore(api, conversationId, nodeId, queued);

  const archiveMutation = useThreadListMutation({
    listKeys: [queryKeys.conversations(projectId), queryKeys.allConversations],
    mutationFn: (next: boolean) => api.conversations.archive(conversationId, next),
    transform: (list, next) =>
      list.map((item) =>
        item.id === conversationId ? { ...item, archivedAt: next ? Date.now() : null } : item,
      ),
  });
  const toggleArchive = async (): Promise<void> => {
    archiveMutation.mutate(!archived);
  };

  return (
    <CommandGroup heading="This thread">
      {available ? <CommandItem onSelect={run(openTerminal.run)}>New terminal</CommandItem> : null}
      {terminals.map((terminal, index) => (
        <CommandItem
          key={terminal.id}
          value={`terminal ${index + 1} ${terminal.title} ${terminal.id}`}
          onSelect={run(() => navigate(terminalPath(projectId, conversationId, terminal.id, nodeId)))}
        >
          Go to terminal: {terminal.title}
        </CommandItem>
      ))}
      {terminals.length > 0 ? (
        <CommandItem onSelect={run(() => navigate(conversationPath(projectId, conversationId, nodeId)))}>
          Go to chat
        </CommandItem>
      ) : null}
      <CommandItem onSelect={onChangeModel}>Change model…</CommandItem>
      {canThink ? <CommandItem onSelect={onChangeThinking}>Change thinking level…</CommandItem> : null}
      <CommandItem onSelect={run(attempt(stop))}>Stop agent</CommandItem>
      <CommandItem onSelect={run(attempt(toggleArchive))}>
        {archived ? "Unarchive thread" : "Archive thread"}
      </CommandItem>
    </CommandGroup>
  );
}
