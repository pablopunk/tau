import { MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { argText } from "../model/tool-state";
import { useChildById } from "./agent-child";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

export function AgentSendMessageTool({ state }: ToolRendererProps) {
  const to = argText(state, "to");
  const child = useChildById(to);
  const message = argText(state, "message");
  return (
    <ToolCard
      icon={<MessageSquare />}
      title={`Message to ${child?.title.trim() || to || "subagent"}`}
      subtitle={message}
      status={state.status}
      badge={<Badge variant="outline">{argText(state, "mode") ?? "followUp"}</Badge>}
    >
      {message ? <p className="whitespace-pre-wrap text-sm">{message}</p> : null}
    </ToolCard>
  );
}
