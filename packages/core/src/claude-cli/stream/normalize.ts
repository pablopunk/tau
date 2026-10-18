import { createHash } from "node:crypto";
import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { CONNECTOR_TOOL_NAME } from "../connectors/names";

type SystemMessage = Extract<Message, { role: "system" }>;

/** A message that counts for the hash, with its canonical text. */
export interface Entry {
  readonly message: Message;
  readonly key: string;
}

type Blocks = string | readonly { readonly type: string }[];

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .map((name) => `${JSON.stringify(name)}:${stableJson(record[name])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function textOfBlocks(content: Blocks): string {
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" ? (block as TextContent).text : "")).join("");
}

export const isAbortedToolResult = (message: ToolResultMessage): boolean =>
  message.isError && /was aborted/.test(textOfBlocks(message.content));

const isFailedAssistant = (message: AssistantMessage): boolean =>
  message.stopReason === "aborted" || message.stopReason === "error";

const blocksKey = (content: Blocks) =>
  typeof content === "string"
    ? content
    : content.map((block) =>
        block.type === "image"
          ? { type: "image", mimeType: (block as ImageContent).mimeType, data: (block as ImageContent).data }
          : { type: "text", text: (block as TextContent).text },
      );

const callsOf = (message: AssistantMessage): ToolCall[] =>
  message.content.filter((block): block is ToolCall => block.type === "toolCall");

export function assistantKey(message: AssistantMessage): string {
  const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  const calls = callsOf(message).map(({ id, name, arguments: args }) => ({ id, name, arguments: args }));
  return stableJson({ role: "assistant", text, calls });
}

const notConnectorTool = ({ name }: { readonly name: string }): boolean => name !== CONNECTOR_TOOL_NAME;

const systemKey = (message: SystemMessage): string =>
  stableJson({
    role: "system",
    content: textOfBlocks(message.content),
    sections: message.sections ?? null,
    added: message.toolsAdded?.filter(notConnectorTool).map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
    removed: message.toolsRemoved?.filter(notConnectorTool).map((tool) => tool.name),
  });

const isEmptySystemKey = (message: SystemMessage): boolean =>
  textOfBlocks(message.content) === "" &&
  Object.keys(message.sections ?? {}).length === 0 &&
  !message.toolsAdded?.some(notConnectorTool) &&
  !message.toolsRemoved?.some(notConnectorTool);

const mentionsConnectorTool = (message: SystemMessage): boolean =>
  [...(message.toolsAdded ?? []), ...(message.toolsRemoved ?? [])].some(
    (tool) => tool.name === CONNECTOR_TOOL_NAME,
  );

/** A system entry whose only change is `claude_connector` added or removed does not count. */
const isConnectorToolOnlyChange = (message: SystemMessage): boolean =>
  mentionsConnectorTool(message) && isEmptySystemKey(message);

function keyOf(message: Message): string {
  if (message.role === "system") return systemKey(message);
  if (message.role === "user") return stableJson({ role: "user", content: blocksKey(message.content) });
  if (message.role === "assistant") return assistantKey(message);
  return stableJson({
    role: "toolResult",
    id: message.toolCallId,
    name: message.toolName,
    content: blocksKey(message.content),
    isError: message.isError,
  });
}

const countsForHash = (message: Message): boolean => {
  if (message.role === "system") return !isConnectorToolOnlyChange(message);
  if (message.role === "assistant") return !isFailedAssistant(message);
  if (message.role === "toolResult") return !isAbortedToolResult(message);
  return true;
};

export const abortedToolCallIds = (messages: readonly Message[]): string[] =>
  messages.flatMap((message) =>
    message.role === "toolResult" && isAbortedToolResult(message) ? [message.toolCallId] : [],
  );

export const normalize = (messages: readonly Message[]): Entry[] =>
  messages.filter(countsForHash).map((message) => ({ message, key: keyOf(message) }));

export const chainHash = (previous: string, key: string): string =>
  createHash("sha1").update(previous).update("\n").update(key).digest("hex");

/** `hashes[n]` covers the first `n` entries; `hashes[0]` is empty. */
export function prefixHashes(entries: readonly Entry[]): string[] {
  const hashes = [""];
  for (const entry of entries) hashes.push(chainHash(hashes.at(-1) ?? "", entry.key));
  return hashes;
}
