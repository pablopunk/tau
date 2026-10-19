import type { ConversationSummary } from "@tau/protocol";
import { Bot } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { conversationPath } from "@/lib/paths";
import { useAllConversations } from "@/lib/queries";
import { useNodeId } from "@/nodes/node-context";
import { argText, resultDetails, resultText } from "../model/tool-state";
import { OutputBlock } from "./OutputBlock";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

function childIdOf(state: ToolRendererProps["state"]): string | undefined {
  const id = resultDetails(state).conversationId;
  return typeof id === "string" ? id : undefined;
}

function useChild(childId: string | undefined) {
  const all = useAllConversations().data;
  return childId ? all?.find((item) => item.id === childId) : undefined;
}

export function cardTitle(continued: boolean, childTitle: string | undefined): string {
  if (!continued) return "New subagent";
  return childTitle ? `Continued ${childTitle}` : "Continued subagent";
}

function OpenChildLink({ child }: { child: ConversationSummary }) {
  const nodeId = useNodeId();
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={conversationPath(child.projectId, child.id, nodeId)}>Open</Link>
    </Button>
  );
}

export function TaskTool({ state }: ToolRendererProps) {
  const childId = childIdOf(state);
  const child = useChild(childId);
  const continued = argText(state, "subagent") !== undefined;
  const answer = resultText(state.result);
  return (
    <ToolCard
      icon={<Bot />}
      title={cardTitle(continued, child?.title)}
      subtitle={argText(state, "description")}
      status={state.status}
    >
      {child ? <OpenChildLink child={child} /> : null}
      {answer ? <OutputBlock text={answer} label="Answer" /> : null}
    </ToolCard>
  );
}
