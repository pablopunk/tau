import { useMatch, useParams } from "react-router";
import { MarkSeenWhileOpen } from "@/activity";
import { Conversation } from "@/conversation";
import { useNodes } from "@/nodes";
import { NodeScope } from "@/nodes/NodeScope";
import { isUsable } from "@/nodes/node-text";
import { ThreadPanes } from "@/panes";
import { NewThreadPage } from "./NewThreadPage";
import { NodeOffline, NodeUnknown } from "./NodeOffline";
import { useNodeTitle } from "./use-node-title";

const LOCAL_TERMINAL = "/p/:projectId/c/:conversationId/terminal/:terminalId";
const NODE_TERMINAL = "/n/:nodeId/p/:projectId/c/:conversationId/terminal/:terminalId";

function useTerminalId(): string | undefined {
  const local = useMatch(LOCAL_TERMINAL)?.params.terminalId;
  const remote = useMatch(NODE_TERMINAL)?.params.terminalId;
  return local ?? remote;
}

function Thread({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  const terminalId = useTerminalId();
  useNodeTitle(conversationId);
  return (
    <>
      <MarkSeenWhileOpen />
      <ThreadPanes projectId={projectId} conversationId={conversationId} terminalId={terminalId}>
        <Conversation key={conversationId} id={conversationId} />
      </ThreadPanes>
    </>
  );
}

function RemoteThread({ nodeId, projectId, conversationId }: ThreadIds & { nodeId: string }) {
  const { nodes, isLoading } = useNodes();
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (isLoading) return null;
  if (!node) return <NodeUnknown />;
  if (!isUsable(node)) return <NodeOffline node={node} />;
  return (
    <NodeScope nodeId={nodeId}>
      <Thread projectId={projectId} conversationId={conversationId} />
    </NodeScope>
  );
}

interface ThreadIds {
  projectId: string;
  conversationId: string;
}

/** `/p/:projectId/c/:conversationId[/terminal[/:id]]` and `/n/:nodeId/...`: the same page, scoped to a node. */
export function ConversationRoute() {
  const { nodeId, projectId, conversationId } = useParams();
  if (!projectId || !conversationId) return <NewThreadPage />;
  if (nodeId === undefined) return <Thread projectId={projectId} conversationId={conversationId} />;
  return <RemoteThread nodeId={nodeId} projectId={projectId} conversationId={conversationId} />;
}
