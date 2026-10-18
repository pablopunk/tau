import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { CONNECTOR_TOOL_NAME, serverLabelOf } from "../connectors/names";
import type { Entry } from "./normalize";
import { stableJson, textOfBlocks } from "./normalize";

export const TOOL_RESULT_LIMIT = 4000;

export function truncateToolResult(text: string): string {
  if (text.length <= TOOL_RESULT_LIMIT) return text;
  const cut = text.length - TOOL_RESULT_LIMIT;
  return `${text.slice(0, TOOL_RESULT_LIMIT)}\n[truncated ${cut} characters]`;
}

const renderUserContent = (content: string | readonly { type: string; text?: string }[]): string =>
  typeof content === "string"
    ? content
    : content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");

const connectorLabelOf = (args: ToolCall["arguments"]): string =>
  `${serverLabelOf(String(args.server ?? ""))} · ${String(args.tool ?? "")}`;

const renderConnectorCall = (call: ToolCall): string =>
  `[connector call ${connectorLabelOf(call.arguments)} (${call.id})] ${stableJson(call.arguments.arguments ?? {})}`;

const renderToolCall = (call: ToolCall): string =>
  call.name === CONNECTOR_TOOL_NAME
    ? renderConnectorCall(call)
    : `[tool call ${call.name} (${call.id})] ${stableJson(call.arguments)}`;

function connectorLabelsById(history: readonly Entry[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const { message } of history) {
    if (message.role !== "assistant") continue;
    for (const block of message.content)
      if (block.type === "toolCall" && block.name === CONNECTOR_TOOL_NAME)
        labels.set(block.id, connectorLabelOf(block.arguments));
  }
  return labels;
}

function renderAssistant(message: AssistantMessage): string {
  const parts = message.content.flatMap((block) => {
    if (block.type === "text") return [block.text];
    if (block.type === "toolCall") return [renderToolCall(block)];
    return [];
  });
  return `[assistant]\n${parts.join("\n")}`;
}

function renderEntry(entry: Entry, connectorLabels: ReadonlyMap<string, string>): string {
  const { message } = entry;
  if (message.role === "user") return `[user]\n${renderUserContent(message.content)}`;
  if (message.role === "assistant") return renderAssistant(message);
  if (message.role === "toolResult") {
    const flag = message.isError ? " error" : "";
    const body = truncateToolResult(textOfBlocks(message.content));
    const connector = connectorLabels.get(message.toolCallId);
    const label = connector ? `connector result ${connector}` : `tool result ${message.toolName}`;
    return `[${label} (${message.toolCallId})${flag}]\n${body}`;
  }
  return "";
}

/** The history seed for a new SDK session: tool results are cut, the rest is whole. */
export function renderRebindTranscript(history: readonly Entry[]): string {
  const labels = connectorLabelsById(history);
  const body = history
    .map((entry) => renderEntry(entry, labels))
    .filter((part) => part.length > 0)
    .join("\n\n");
  return `<conversation-so-far>\n${body}\n</conversation-so-far>`;
}
