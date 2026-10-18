import type { ImageContent, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ClaudeContentBlock, ClaudeToolResult } from "../sdk-types";
import type { Entry } from "./normalize";

const toBlock = (block: TextContent | ImageContent): ClaudeContentBlock =>
  block.type === "image"
    ? { type: "image", data: block.data, mimeType: block.mimeType }
    : { type: "text", text: block.text };

export const toMcpResult = (message: ToolResultMessage): ClaudeToolResult => ({
  content: message.content.map(toBlock),
  isError: message.isError,
});

export function toolResultAsText(message: ToolResultMessage): string {
  const errorAttribute = message.isError ? ' error="true"' : "";
  const body = message.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");
  return `<tool-result id="${message.toolCallId}" name="${message.toolName}"${errorAttribute}>\n${body}\n</tool-result>`;
}

function blocksOfEntry(entry: Entry): ClaudeContentBlock[] {
  const { message } = entry;
  if (message.role === "toolResult") return [{ type: "text", text: toolResultAsText(message) }];
  if (message.role !== "user") return [];
  if (typeof message.content === "string") return [{ type: "text", text: message.content }];
  return message.content.map(toBlock);
}

function mergeTextBlocks(blocks: readonly ClaudeContentBlock[]): ClaudeContentBlock[] {
  const merged: ClaudeContentBlock[] = [];
  for (const block of blocks) {
    const last = merged.at(-1);
    if (block.type === "text" && last?.type === "text") {
      merged[merged.length - 1] = { type: "text", text: `${last.text}\n\n${block.text}` };
    } else merged.push(block);
  }
  return merged;
}

/** One user message for a list of user messages and tool results. */
export function contentOfEntries(entries: readonly Entry[]): string | ClaudeContentBlock[] {
  const merged = mergeTextBlocks(entries.flatMap(blocksOfEntry));
  const [only] = merged;
  if (merged.length === 1 && only?.type === "text") return only.text;
  return merged;
}

export const prependText = (
  text: string,
  content: string | readonly ClaudeContentBlock[],
): string | ClaudeContentBlock[] => {
  const merged = mergeTextBlocks([
    { type: "text", text },
    ...(typeof content === "string" ? [{ type: "text" as const, text: content }] : content),
  ]);
  const [only] = merged;
  return merged.length === 1 && only?.type === "text" ? only.text : merged;
};
