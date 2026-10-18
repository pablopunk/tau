import { FilePen } from "lucide-react";
import { argText, resultDetails, resultText } from "../model/tool-state";
import { DiffView } from "./DiffView";
import { diffStats, parseDiff } from "./diff-lines";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

interface EditArgument {
  readonly oldText?: string;
  readonly newText?: string;
}

function diffFromArguments(state: ToolRendererProps["state"]): string {
  const edits = (state.call.arguments?.edits ?? []) as readonly EditArgument[];
  return edits
    .flatMap((edit) => [
      ...(edit.oldText ?? "").split("\n").map((line) => `-${line}`),
      ...(edit.newText ?? "").split("\n").map((line) => `+${line}`),
    ])
    .join("\n");
}

function diffOf(state: ToolRendererProps["state"]): string {
  const details = resultDetails(state);
  if (typeof details.patch === "string" && details.patch) return details.patch;
  if (typeof details.diff === "string" && details.diff) return details.diff;
  return diffFromArguments(state);
}

function ChangeCount({ diff }: { diff: string }) {
  const { added, removed } = diffStats(parseDiff(diff));
  if (!added && !removed) return null;
  return (
    <span className="shrink-0 font-mono text-xs">
      <span className="text-success">+{added}</span> <span className="text-destructive">-{removed}</span>
    </span>
  );
}

export function EditTool({ state }: ToolRendererProps) {
  const diff = diffOf(state);
  const failure = state.status === "error" ? resultText(state.result) : "";
  return (
    <ToolCard
      icon={<FilePen />}
      title="Edit"
      subtitle={argText(state, "path")}
      status={state.status}
      badge={<ChangeCount diff={diff} />}
    >
      {failure ? <p className="text-sm text-destructive">{failure}</p> : null}
      {diff ? <DiffView diff={diff} /> : null}
    </ToolCard>
  );
}
