import { Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { argText, resultText } from "../model/tool-state";
import { OutputBlock } from "./OutputBlock";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

const UNAVAILABLE_PREFIX = "Tool claude_connector is not available";
const UNAVAILABLE_TEXT = "Claude connectors need a Claude CLI model";

export const connectorLabel = (server: string | undefined, tool: string | undefined): string =>
  `${(server ?? "?").replace(/^claude\.ai /, "")} · ${tool ?? "?"}`;

export const connectorOutput = (text: string): string =>
  text.startsWith(UNAVAILABLE_PREFIX) ? UNAVAILABLE_TEXT : text;

function argumentsText(state: ToolRendererProps["state"]): string {
  const args = state.call.arguments?.arguments;
  return args && typeof args === "object" && Object.keys(args).length ? JSON.stringify(args, null, 2) : "";
}

export function ClaudeConnectorTool({ state }: ToolRendererProps) {
  const args = argumentsText(state);
  const output = connectorOutput(resultText(state.result) || (state.slot?.output ?? ""));
  return (
    <ToolCard
      icon={<Plug />}
      title={connectorLabel(argText(state, "server"), argText(state, "tool"))}
      status={state.status}
      badge={state.status === "error" ? <Badge variant="destructive">Error</Badge> : null}
    >
      {args ? <OutputBlock text={args} label="Arguments" /> : null}
      {output ? <OutputBlock text={output} label="Result" /> : null}
    </ToolCard>
  );
}
