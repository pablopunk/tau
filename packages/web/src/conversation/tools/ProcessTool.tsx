import type { ProcessInfo } from "@tau/protocol";
import { Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { stateLabel } from "@/processes/process-state";
import { argText, resultText } from "../model/tool-state";
import { OutputBlock } from "./OutputBlock";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

const LAST_LINES = 8;

function parseInfo(text: string): ProcessInfo | undefined {
  try {
    const value = JSON.parse(text) as Partial<ProcessInfo>;
    return typeof value.id === "string" && typeof value.state === "string"
      ? (value as ProcessInfo)
      : undefined;
  } catch {
    return undefined;
  }
}

function lastLines(text: string): string {
  return text.replace(/\n$/, "").split("\n").slice(-LAST_LINES).join("\n");
}

export function ProcessTool({ state }: ToolRendererProps) {
  const text = resultText(state.result);
  const info = parseInfo(text);
  const name = info?.name ?? argText(state, "name") ?? argText(state, "command") ?? argText(state, "id");
  const logs = info || !text ? "" : lastLines(text);
  return (
    <ToolCard
      icon={<Server />}
      title={state.call.name.replace("_", " ")}
      subtitle={name}
      status={state.status}
      badge={info ? <Badge variant="secondary">{stateLabel(info)}</Badge> : null}
    >
      {info?.urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="block text-xs underline">
          {url}
        </a>
      ))}
      {logs ? <OutputBlock text={logs} label="Process output" keep="end" /> : null}
    </ToolCard>
  );
}
