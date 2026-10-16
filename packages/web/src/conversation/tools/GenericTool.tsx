import { Wrench } from "lucide-react";
import { resultText } from "../model/tool-state";
import { OutputBlock } from "./OutputBlock";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

function argumentsText(state: ToolRendererProps["state"]): string {
  const args = state.call.arguments ?? {};
  return Object.keys(args).length ? JSON.stringify(args, null, 2) : "";
}

export function GenericTool({ state }: ToolRendererProps) {
  const args = argumentsText(state);
  const output = resultText(state.result) || (state.slot?.output ?? "");
  return (
    <ToolCard icon={<Wrench />} title={state.call.name} status={state.status}>
      {args ? <OutputBlock text={args} label="Arguments" /> : null}
      {output ? <OutputBlock text={output} label="Result" /> : null}
    </ToolCard>
  );
}
