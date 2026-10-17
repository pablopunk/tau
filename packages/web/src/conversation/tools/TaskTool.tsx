import { Bot } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { conversationPath } from "@/lib/paths";
import { useAllConversations } from "@/lib/queries";
import { argText, resultDetails, resultText } from "../model/tool-state";
import { OutputBlock } from "./OutputBlock";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

function childIdOf(state: ToolRendererProps["state"]): string | undefined {
  const id = resultDetails(state).conversationId;
  return typeof id === "string" ? id : undefined;
}

function OpenChildLink({ childId }: { childId: string }) {
  const child = useAllConversations().data?.find((item) => item.id === childId);
  if (!child) return null;
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={conversationPath(child.projectId, child.id)}>Open</Link>
    </Button>
  );
}

export function TaskTool({ state }: ToolRendererProps) {
  const childId = childIdOf(state);
  const answer = resultText(state.result);
  return (
    <ToolCard
      icon={<Bot />}
      title="Subagent"
      subtitle={argText(state, "description")}
      status={state.status}
      defaultOpen
    >
      {childId ? <OpenChildLink childId={childId} /> : null}
      {answer ? <OutputBlock text={answer} label="Answer" /> : null}
    </ToolCard>
  );
}
