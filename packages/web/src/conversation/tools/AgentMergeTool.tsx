import { GitMerge } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { argText, resultText } from "../model/tool-state";
import { useChildById } from "./agent-child";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

export function AgentMergeTool({ state }: ToolRendererProps) {
  const id = argText(state, "id");
  const child = useChildById(id);
  const text = resultText(state.result);
  const conflict = state.status === "error";
  return (
    <ToolCard
      icon={<GitMerge />}
      title={`Merge ${child?.title.trim() || id || "subagent"}`}
      status={state.status}
      defaultOpen={conflict}
    >
      {text ? (
        <Alert
          variant={conflict ? "destructive" : "default"}
          data-merge-result={conflict ? "conflict" : "merged"}
        >
          <AlertDescription className="whitespace-pre-wrap">{text}</AlertDescription>
        </Alert>
      ) : null}
    </ToolCard>
  );
}
