import type { AssistantMessage, AssistantMessageEvent, ToolCall } from "@earendil-works/pi-ai";
import { CONNECTOR_TOOL_NAME, type ConnectorCall, observedCallOf } from "../connectors/names";
import type { ClaudeSdkMessage } from "../sdk-types";
import { TOOL_NAME_PREFIX } from "../tool-server";
import { mergeUsage, type RawUsage } from "./usage";

export interface ReaderSummary {
  readonly stopReason: "stop" | "toolUse" | "length";
  readonly errorCode: string | null;
  readonly lastUuid: string | null;
  readonly toolUseIds: readonly string[];
}

interface BlockPayload {
  readonly type?: string;
  readonly id?: string;
  readonly name?: string;
  readonly data?: string;
}

interface StreamEventPayload {
  readonly type?: string;
  readonly index?: number;
  readonly message?: { readonly id?: string; readonly model?: string; readonly usage?: RawUsage };
  readonly content_block?: BlockPayload;
  readonly delta?: {
    readonly type?: string;
    readonly text?: string;
    readonly thinking?: string;
    readonly partial_json?: string;
    readonly signature?: string;
    readonly stop_reason?: string;
  };
  readonly usage?: RawUsage;
}

interface OpenBlock {
  readonly contentIndex: number;
  readonly kind: "text" | "thinking" | "toolCall";
  readonly connector?: ConnectorCall;
  json: string;
}

export interface ApiMessageReader {
  feed(message: ClaudeSdkMessage): void;
  /** Drops tool calls whose arguments never finished, for an aborted message. */
  dropOpenToolCalls(): void;
}

const stopReasonOf = (raw: string | undefined): ReaderSummary["stopReason"] => {
  if (raw === "tool_use") return "toolUse";
  if (raw === "max_tokens") return "length";
  return "stop";
};

export const stripToolPrefix = (name: string): string =>
  name.startsWith(TOOL_NAME_PREFIX) ? name.slice(TOOL_NAME_PREFIX.length) : name;

const asConnectorArguments = (
  connector: ConnectorCall,
  parsed: Pick<ToolCall, "arguments" | "argumentsError">,
): Pick<ToolCall, "arguments" | "argumentsError"> => ({
  ...parsed,
  arguments: { server: connector.server, tool: connector.tool, arguments: parsed.arguments },
});

function parseArguments(json: string): Pick<ToolCall, "arguments" | "argumentsError"> {
  try {
    const parsed: unknown = JSON.parse(json.length > 0 ? json : "{}");
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { arguments: parsed as ToolCall["arguments"] };
    }
    return { arguments: {}, argumentsError: `Tool arguments were not a JSON object: ${json}` };
  } catch {
    return { arguments: {}, argumentsError: `Tool arguments were not valid JSON: ${json}` };
  }
}

/** Reads the SDK messages of one API message and pushes the matching pi-ai events. */
export function createApiMessageReader(
  message: AssistantMessage,
  push: (event: AssistantMessageEvent) => void,
  onComplete: (summary: ReaderSummary) => void,
): ApiMessageReader {
  const open = new Map<number, OpenBlock>();
  let blocksStarted = 0;
  let assistantsSeen = 0;
  let stopped = false;
  let completed = false;
  let rawStop: string | undefined;
  let errorCode: string | null = null;
  let lastUuid: string | null = null;
  const toolUseIds: string[] = [];

  const maybeComplete = () => {
    if (completed || !stopped || assistantsSeen < blocksStarted) return;
    completed = true;
    onComplete({ stopReason: stopReasonOf(rawStop), errorCode, lastUuid, toolUseIds });
  };

  const startBlock = (index: number, block: BlockPayload) => {
    blocksStarted += 1;
    const contentIndex = message.content.length;
    if (block.type === "tool_use") {
      const connector = observedCallOf(block.name ?? "") ?? undefined;
      const call: ToolCall = {
        type: "toolCall",
        id: block.id ?? "",
        name: connector ? CONNECTOR_TOOL_NAME : stripToolPrefix(block.name ?? ""),
        arguments: {},
      };
      toolUseIds.push(call.id);
      message.content.push(call);
      open.set(index, { contentIndex, kind: "toolCall", connector, json: "" });
      push({ type: "toolcall_start", contentIndex, partial: message });
      return;
    }
    const thinking = block.type === "thinking" || block.type === "redacted_thinking";
    message.content.push(
      thinking
        ? { type: "thinking", thinking: "", ...(block.data && { thinkingSignature: block.data }) }
        : { type: "text", text: "" },
    );
    open.set(index, { contentIndex, kind: thinking ? "thinking" : "text", json: "" });
    push({ type: thinking ? "thinking_start" : "text_start", contentIndex, partial: message });
  };

  const applyDelta = (index: number, delta: NonNullable<StreamEventPayload["delta"]>) => {
    const block = open.get(index);
    const content = block ? message.content[block.contentIndex] : undefined;
    if (!block || !content) return;
    if (delta.type === "text_delta" && content.type === "text") {
      content.text += delta.text ?? "";
      push({
        type: "text_delta",
        contentIndex: block.contentIndex,
        delta: delta.text ?? "",
        partial: message,
      });
    } else if (delta.type === "thinking_delta" && content.type === "thinking") {
      content.thinking += delta.thinking ?? "";
      push({
        type: "thinking_delta",
        contentIndex: block.contentIndex,
        delta: delta.thinking ?? "",
        partial: message,
      });
    } else if (delta.type === "input_json_delta" && content.type === "toolCall") {
      block.json += delta.partial_json ?? "";
      push({
        type: "toolcall_delta",
        contentIndex: block.contentIndex,
        delta: delta.partial_json ?? "",
        partial: message,
      });
    } else if (delta.type === "signature_delta" && content.type === "thinking") {
      content.thinkingSignature = delta.signature;
    }
  };

  const stopBlock = (index: number) => {
    const block = open.get(index);
    const content = block ? message.content[block.contentIndex] : undefined;
    if (!block || !content) return;
    open.delete(index);
    if (content.type === "text") {
      push({ type: "text_end", contentIndex: block.contentIndex, content: content.text, partial: message });
    } else if (content.type === "thinking") {
      push({
        type: "thinking_end",
        contentIndex: block.contentIndex,
        content: content.thinking,
        partial: message,
      });
    } else {
      const parsed = parseArguments(block.json);
      Object.assign(content, block.connector ? asConnectorArguments(block.connector, parsed) : parsed);
      push({ type: "toolcall_end", contentIndex: block.contentIndex, toolCall: content, partial: message });
    }
  };

  const onStreamEvent = (event: StreamEventPayload) => {
    if (event.type === "message_start") {
      message.responseId = event.message?.id;
      message.responseModel = event.message?.model;
      mergeUsage(message.usage, event.message?.usage);
      push({ type: "start", partial: message });
    } else if (event.type === "content_block_start") {
      startBlock(event.index ?? 0, event.content_block ?? {});
    } else if (event.type === "content_block_delta") {
      applyDelta(event.index ?? 0, event.delta ?? {});
    } else if (event.type === "content_block_stop") {
      stopBlock(event.index ?? 0);
    } else if (event.type === "message_delta") {
      rawStop = event.delta?.stop_reason ?? rawStop;
      mergeUsage(message.usage, event.usage);
    } else if (event.type === "message_stop") {
      stopped = true;
      maybeComplete();
    }
  };

  const onAssistant = (sdk: ClaudeSdkMessage) => {
    assistantsSeen += 1;
    if (typeof sdk.uuid === "string") lastUuid = sdk.uuid;
    if (typeof sdk.error === "string") errorCode = sdk.error;
    maybeComplete();
  };

  return {
    feed(sdk) {
      if (completed) return;
      if (sdk.type === "stream_event") onStreamEvent(sdk.event as StreamEventPayload);
      else if (sdk.type === "assistant") onAssistant(sdk);
    },
    dropOpenToolCalls() {
      const dropped = new Set(
        [...open.values()].filter((block) => block.kind === "toolCall").map((block) => block.contentIndex),
      );
      message.content = message.content.filter((_, index) => !dropped.has(index));
    },
  };
}
