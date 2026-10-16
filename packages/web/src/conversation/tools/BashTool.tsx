import { Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { argText, exitCodeOf, isActive, resultDetails, resultText, wasAborted } from "../model/tool-state";
import { OutputBlock } from "./OutputBlock";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

function outputOf(state: ToolRendererProps["state"]): string {
  return state.result ? resultText(state.result) : (state.slot?.output ?? "");
}

function wasTruncated(state: ToolRendererProps["state"]): boolean {
  const details = resultDetails(state);
  const truncation = details.truncation as { truncated?: boolean } | undefined;
  return (
    details.truncated === true ||
    truncation?.truncated === true ||
    (state.slot?.droppedLines ?? 0) > 0 ||
    (state.slot?.droppedBytes ?? 0) > 0
  );
}

function ExitBadge({ state }: ToolRendererProps) {
  if (wasAborted(state.result)) return <Badge variant="secondary">Stopped</Badge>;
  const exitCode = exitCodeOf(state.result);
  if (exitCode === undefined) return null;
  return <Badge variant="destructive">Exit {exitCode}</Badge>;
}

export function BashTool({ state }: ToolRendererProps) {
  const output = outputOf(state);
  return (
    <ToolCard
      icon={<Terminal />}
      title="Bash"
      subtitle={argText(state, "command")}
      status={state.status}
      badge={<ExitBadge state={state} />}
      defaultOpen={isActive(state.status) || state.status === "error"}
    >
      {output ? <OutputBlock text={output} label="Command output" keep="end" /> : null}
      {wasTruncated(state) ? <p className="text-xs text-muted-foreground">Output was truncated.</p> : null}
      {!output && !isActive(state.status) ? (
        <p className="text-xs text-muted-foreground">No output.</p>
      ) : null}
    </ToolCard>
  );
}
