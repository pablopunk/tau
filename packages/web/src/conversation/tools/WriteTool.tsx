import { FilePlus2 } from "lucide-react";
import { argText } from "../model/tool-state";
import { OutputBlock } from "./OutputBlock";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

export function WriteTool({ state }: ToolRendererProps) {
  const content = argText(state, "content");
  return (
    <ToolCard icon={<FilePlus2 />} title="Write" subtitle={argText(state, "path")} status={state.status}>
      {content ? <OutputBlock text={content} label="Written content" /> : null}
    </ToolCard>
  );
}
