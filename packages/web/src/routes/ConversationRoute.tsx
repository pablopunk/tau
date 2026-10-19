import { useMatch, useParams } from "react-router";
import { MarkSeenWhileOpen } from "@/activity";
import { Conversation } from "@/conversation";
import { useMachines } from "@/machines";
import { MachineScope } from "@/machines/MachineScope";
import { isUsable } from "@/machines/machine-text";
import { ThreadPanes } from "@/panes";
import { MachineOffline, MachineUnknown } from "./MachineOffline";
import { NewThreadPage } from "./NewThreadPage";
import { useMachineTitle } from "./use-machine-title";

const LOCAL_TERMINAL = "/p/:projectId/c/:conversationId/terminal/:terminalId";
const MACHINE_TERMINAL = "/m/:machineId/p/:projectId/c/:conversationId/terminal/:terminalId";

function useTerminalId(): string | undefined {
  const local = useMatch(LOCAL_TERMINAL)?.params.terminalId;
  const remote = useMatch(MACHINE_TERMINAL)?.params.terminalId;
  return local ?? remote;
}

function Thread({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  const terminalId = useTerminalId();
  useMachineTitle(conversationId);
  return (
    <>
      <MarkSeenWhileOpen />
      <ThreadPanes projectId={projectId} conversationId={conversationId} terminalId={terminalId}>
        <Conversation key={conversationId} id={conversationId} />
      </ThreadPanes>
    </>
  );
}

function RemoteThread({ machineId, projectId, conversationId }: ThreadIds & { machineId: string }) {
  const { machines, isLoading } = useMachines();
  const machine = machines.find((candidate) => candidate.id === machineId);
  if (isLoading) return null;
  if (!machine) return <MachineUnknown />;
  if (!isUsable(machine)) return <MachineOffline machine={machine} />;
  return (
    <MachineScope machineId={machineId}>
      <Thread projectId={projectId} conversationId={conversationId} />
    </MachineScope>
  );
}

interface ThreadIds {
  projectId: string;
  conversationId: string;
}

/** `/p/:projectId/c/:conversationId[/terminal[/:id]]` and `/m/:machineId/...`: the same page, scoped to a machine. */
export function ConversationRoute() {
  const { machineId, projectId, conversationId } = useParams();
  if (!projectId || !conversationId) return <NewThreadPage />;
  if (machineId === undefined) return <Thread projectId={projectId} conversationId={conversationId} />;
  return <RemoteThread machineId={machineId} projectId={projectId} conversationId={conversationId} />;
}
