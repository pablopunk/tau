import { FileText } from "lucide-react";
import { argText, resultText } from "../model/tool-state";
import { OutputBlock } from "./OutputBlock";
import { resultImagesOf } from "./ResultImages";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

function rangeOf(state: ToolRendererProps["state"]): string | undefined {
  const { offset, limit } = state.call.arguments ?? {};
  if (typeof offset !== "number" && typeof limit !== "number") return undefined;
  const start = typeof offset === "number" ? offset : 1;
  return typeof limit === "number" ? `lines ${start}-${start + limit - 1}` : `from line ${start}`;
}

export function ReadTool({ state }: ToolRendererProps) {
  const text = resultText(state.result);
  const range = rangeOf(state);
  return (
    <ToolCard
      icon={<FileText />}
      title="Read"
      subtitle={[argText(state, "path"), range].filter(Boolean).join("  ")}
      status={state.status}
    >
      {text ? <OutputBlock text={text} label="File content" /> : null}
      {resultImagesOf(state)}
    </ToolCard>
  );
}
