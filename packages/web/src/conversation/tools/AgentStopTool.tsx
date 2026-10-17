import { Square } from "lucide-react";
import { argText } from "../model/tool-state";
import { useChildById } from "./agent-child";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

export function AgentStopTool({ state }: ToolRendererProps) {
  const id = argText(state, "id");
  const child = useChildById(id);
  return (
    <ToolCard
      icon={<Square />}
      title={`Stop ${child?.title.trim() || id || "subagent"}`}
      status={state.status}
    />
  );
}
