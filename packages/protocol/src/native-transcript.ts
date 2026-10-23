import { type NativeEvent, nativeEventsOf } from "./native-events";
import type { ToolResultInfo, TranscriptItem } from "./projection";
import type { AssistantMessage, ConversationView, ToolCall, ToolResultMessage } from "./view";

export interface NativeTranscript {
  readonly items: TranscriptItem[];
  readonly results: Map<string, ToolResultInfo>;
}

type Block = AssistantMessage["content"][number];
type TextEvent = Extract<NativeEvent, { type: "assistant-text" | "assistant-thinking" }>;

interface OpenGroup {
  readonly key: string;
  messageId: string | undefined;
  readonly blocks: Block[];
}

const NATIVE_PROVIDER = "claude-code";

const ZERO_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const itemKeyOf = (key: string): string => `native.event:${key}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function assistantMessageOf(
  blocks: Block[],
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: blocks,
    api: NATIVE_PROVIDER,
    provider: NATIVE_PROVIDER,
    model: NATIVE_PROVIDER,
    usage: ZERO_USAGE,
    stopReason,
    timestamp: 0,
    ...(errorMessage !== undefined && { errorMessage }),
  };
}

function assistantItemOf(key: string, message: AssistantMessage): TranscriptItem {
  return { kind: "assistant", key: itemKeyOf(key), entryId: key, message };
}

const hasToolCall = (blocks: readonly Block[]): boolean => blocks.some((block) => block.type === "toolCall");

function argumentsOf(input: unknown): ToolCall["arguments"] {
  return (isPlainObject(input) ? input : { input }) as ToolCall["arguments"];
}

function toolResultOf(
  event: Extract<NativeEvent, { type: "tool-result" }>,
  toolName: string,
): ToolResultInfo {
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId: event.callId,
    toolName,
    content: event.text === "" ? [] : [{ type: "text", text: event.text }],
    isError: event.isError,
    timestamp: 0,
    ...(event.imageCount > 0 && { details: { imageCount: event.imageCount } }),
  };
  return { message, diagnostics: [] };
}

function textBlockOf(event: TextEvent): Block | undefined {
  if (event.type === "assistant-text") return { type: "text", text: event.text };
  return event.visible ? { type: "thinking", thinking: event.text } : undefined;
}

export function nativeTranscriptOf(view: ConversationView): NativeTranscript {
  const items: TranscriptItem[] = [];
  const results = new Map<string, ToolResultInfo>();
  const toolNames = new Map<string, string>();
  let open: OpenGroup | undefined;

  function closeGroup(): void {
    if (open && open.blocks.length > 0) {
      const stopReason = hasToolCall(open.blocks) ? "toolUse" : "stop";
      items.push(assistantItemOf(open.key, assistantMessageOf(open.blocks, stopReason)));
    }
    open = undefined;
  }

  function groupFor(key: string, messageId: string | undefined): OpenGroup {
    const compatible =
      messageId === undefined || open?.messageId === undefined || open.messageId === messageId;
    if (open && compatible) {
      open.messageId ??= messageId;
      return open;
    }
    closeGroup();
    open = { key, messageId, blocks: [] };
    return open;
  }

  function addToolCall(event: Extract<NativeEvent, { type: "tool-call" }>): void {
    toolNames.set(event.callId, event.name);
    const call: ToolCall = {
      type: "toolCall",
      id: event.callId,
      name: event.name,
      arguments: argumentsOf(event.input),
    };
    groupFor(event.key, undefined).blocks.push(call);
  }

  function addText(event: TextEvent): void {
    const block = textBlockOf(event);
    const group = groupFor(event.key, event.messageId);
    if (block) group.blocks.push(block);
  }

  function addStandalone(item: TranscriptItem): void {
    closeGroup();
    items.push(item);
  }

  for (const event of nativeEventsOf(view)) {
    if (event.type === "assistant-text" || event.type === "assistant-thinking") addText(event);
    else if (event.type === "tool-call") addToolCall(event);
    else if (event.type === "tool-result") {
      closeGroup();
      results.set(event.callId, toolResultOf(event, toolNames.get(event.callId) ?? ""));
    } else if (event.type === "user") {
      addStandalone({
        kind: "user",
        key: itemKeyOf(event.key),
        entryId: event.key,
        text: event.text,
        images: [],
      });
    } else if (event.type === "notice") {
      addStandalone({ kind: "notice", key: itemKeyOf(event.key), data: { text: event.text } });
    } else if (event.type === "result" && event.isError) {
      const message = assistantMessageOf([], "error", event.text ?? event.subtype);
      addStandalone(assistantItemOf(event.key, message));
    } else if (event.type === "result") closeGroup();
  }
  closeGroup();
  return { items, results };
}
