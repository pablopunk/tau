import { Link } from "react-router";
import { conversationPath } from "@/lib/paths";
import { useAllConversations } from "@/lib/queries";
import { useNodeId } from "@/nodes/node-context";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { agentTypeLabel, isRunningChild, modelWithLevel } from "./agent-meta";
import { StopAgentButton } from "./StopAgentButton";
import { useModelLabel } from "./use-model-label";

export function SubagentBanner({ parentId, childId }: { parentId: string; childId?: string }) {
  const nodeId = useNodeId();
  const all = useAllConversations().data;
  const modelLabel = useModelLabel();
  const parent = all?.find((item) => item.id === parentId);
  const child = childId ? all?.find((item) => item.id === childId) : undefined;
  if (!parent) return null;
  const model = modelWithLevel(modelLabel.ofRef(child?.agentModel), child?.agentThinking);
  return (
    <div className="flex items-center gap-2 border-b px-4 py-1.5 text-xs text-muted-foreground">
      <p className="min-w-0 flex-1 truncate">
        Subagent of{" "}
        <Link className="underline" to={conversationPath(parent.projectId, parent.id, nodeId)}>
          {parent.title.trim() || "New thread"}
        </Link>
        {child ? ` · ${agentTypeLabel(child.agentType)}` : null}
        {model ? ` · ${model}` : null}
      </p>
      <AgentStatusBadge status={child?.agentStatus} />
      {childId && isRunningChild(child) ? <StopAgentButton childId={childId} /> : null}
    </div>
  );
}
