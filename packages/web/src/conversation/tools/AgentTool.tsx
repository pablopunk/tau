import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AgentStatusBadge } from "@/sidebar/subagents/AgentStatusBadge";
import { agentTypeLabel, cardStatusOf, isRunningChild, modelWithLevel } from "@/sidebar/subagents/agent-meta";
import { StopAgentButton } from "@/sidebar/subagents/StopAgentButton";
import { useModelLabel } from "@/sidebar/subagents/use-model-label";
import { argText, resultText } from "../model/tool-state";
import { AgentOpenLink } from "./AgentOpenLink";
import { childIdOfCall, useChildById } from "./agent-child";
import { OutputBlock } from "./OutputBlock";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

export function AgentTool({ state }: ToolRendererProps) {
  const childId = childIdOfCall(state);
  const child = useChildById(childId);
  const modelLabel = useModelLabel();
  const type = child?.agentType ?? argText(state, "subagent_type");
  const model = modelWithLevel(
    modelLabel.ofRef(child?.agentModel) ?? argText(state, "model"),
    child?.agentThinking ?? argText(state, "thinking"),
  );
  const answer = resultText(state.result);
  return (
    <ToolCard
      icon={<Bot />}
      title={child?.title.trim() || "Subagent"}
      subtitle={argText(state, "description")}
      status={cardStatusOf(child, state.status)}
      defaultOpen
      badge={<Badge variant="secondary">{agentTypeLabel(type)}</Badge>}
    >
      <div className="flex flex-wrap items-center gap-2">
        {model ? <Badge variant="outline">{model}</Badge> : null}
        <AgentStatusBadge status={child?.agentStatus} />
        {child ? <AgentOpenLink child={child} /> : null}
        {childId && isRunningChild(child) ? <StopAgentButton childId={childId} /> : null}
      </div>
      {answer ? <OutputBlock text={answer} label={state.status === "error" ? "Error" : "Answer"} /> : null}
    </ToolCard>
  );
}
