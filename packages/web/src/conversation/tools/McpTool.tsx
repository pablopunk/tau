import { Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { argText, resultText } from "../model/tool-state";
import { GenericTool } from "./GenericTool";
import { OutputBlock } from "./OutputBlock";
import { resultImagesOf } from "./ResultImages";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

const outputOf = (state: ToolRendererProps["state"]) =>
  state.result ? resultText(state.result) : (state.slot?.output ?? "");

function argumentsText(state: ToolRendererProps["state"]): string {
  const args = state.call.arguments?.arguments;
  return args && typeof args === "object" && Object.keys(args).length ? JSON.stringify(args, null, 2) : "";
}

function CallCard({ state }: ToolRendererProps) {
  const args = argumentsText(state);
  const output = outputOf(state);
  return (
    <ToolCard
      icon={<Plug />}
      title="MCP"
      subtitle={`${argText(state, "server") ?? "?"}/${argText(state, "tool") ?? "?"}`}
      status={state.status}
      badge={state.status === "error" ? <Badge variant="destructive">Error</Badge> : null}
    >
      {args ? <OutputBlock text={args} label="Arguments" /> : null}
      {output ? <OutputBlock text={output} label="Result" /> : null}
      {resultImagesOf(state)}
    </ToolCard>
  );
}

function SearchCard({ state }: ToolRendererProps) {
  const output = outputOf(state);
  return (
    <ToolCard icon={<Plug />} title="MCP tools" subtitle={argText(state, "query")} status={state.status}>
      {output ? <OutputBlock text={output} label="Matching tools" /> : null}
    </ToolCard>
  );
}

export function McpTool({ state }: ToolRendererProps) {
  if (state.call.name === "mcp_call") return <CallCard state={state} />;
  if (state.call.name === "mcp_search") return <SearchCard state={state} />;
  return <GenericTool state={state} />;
}
