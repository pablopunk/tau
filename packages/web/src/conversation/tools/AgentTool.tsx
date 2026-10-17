import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AgentStatusBadge } from "@/sidebar/subagents/AgentStatusBadge";
import { agentModelLabel, agentTypeLabel, isRunningChild } from "@/sidebar/subagents/agent-meta";
import { StopAgentButton } from "@/sidebar/subagents/StopAgentButton";
import { argText, resultText } from "../model/tool-state";
import { AgentOpenLink } from "./AgentOpenLink";
import { childIdOfCall, useChildById } from "./agent-child";
import { OutputBlock } from "./OutputBlock";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

export function AgentTool({ state }: ToolRendererProps) {
  const childId = childIdOfCall(state);
  const child = useChildById(childId);
  const type = child?.agentType ?? argText(state, "subagent_type");
  const model = agentModelLabel(child?.agentModel) ?? argText(state, "model");
  const answer = resultText(state.result);
  return (
    <ToolCard
      icon={<Bot />}
      title={child?.title.trim() || "Subagent"}
      subtitle={argText(state, "description")}
      status={state.status}
      defaultOpen
      badge={<Badge variant="secondary">{agentTypeLabel(type)}</Badge>}
    >
      <div className="flex flex-wrap items-center gap-2">
        {model ? <Badge variant="outline">{model}</Badge> : null}
        <AgentStatusBadge status={child?.agentStatus} />
        {child ? <AgentOpenLink child={child} /> : null}
        {childId && isRunningChild(child) ? <StopAgentButton childId={childId} /> : null}
      </div>
      {answer ? <OutputBlock text={answer} label="Answer" /> : null}
    </ToolCard>
  );
}
