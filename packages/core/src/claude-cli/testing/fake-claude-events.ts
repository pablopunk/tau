import type { ClaudeSdkMessage } from "../sdk-types";
import type { FakeRateLimit } from "./fake-claude-script";

export const FAKE_USAGE = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};
export const FAKE_CONTEXT_WINDOW = 1_000_000;

export interface MessageIds {
  messageId(): string;
  uuid(): string;
  toolUseId(): string;
}

export function createMessageIds(): MessageIds {
  let message = 0;
  let uuid = 0;
  let tool = 0;
  return {
    messageId: () => `msg_fake_${++message}`,
    uuid: () => `uuid-fake-${++uuid}`,
    toolUseId: () => `toolu_fake_${++tool}`,
  };
}

interface Block {
  readonly type: "text" | "thinking" | "tool_use";
  readonly [field: string]: unknown;
}

const streamEvent = (sessionId: string, event: Record<string, unknown>): ClaudeSdkMessage => ({
  type: "stream_event",
  session_id: sessionId,
  event,
});

const deltaOf = (block: Block): Record<string, unknown> => {
  if (block.type === "text") return { type: "text_delta", text: block.text };
  if (block.type === "thinking") return { type: "thinking_delta", thinking: block.thinking };
  return { type: "input_json_delta", partial_json: JSON.stringify(block.input) };
};

const startOf = (block: Block): Record<string, unknown> =>
  block.type === "tool_use" ? { ...block, input: {} } : { ...block, text: "", thinking: "" };

export interface ApiMessage {
  readonly id: string;
  readonly model: string;
  readonly blocks: readonly Block[];
  readonly stopReason: "end_turn" | "tool_use";
  readonly error?: string;
}

/** Stream events, then one `assistant` message per content block, as the SDK emits them. */
export function apiMessageEvents(
  sessionId: string,
  message: ApiMessage,
  ids: MessageIds,
): ClaudeSdkMessage[] {
  const events: ClaudeSdkMessage[] = [
    streamEvent(sessionId, {
      type: "message_start",
      message: { id: message.id, model: message.model, usage: FAKE_USAGE },
    }),
  ];
  message.blocks.forEach((block, index) => {
    events.push(
      streamEvent(sessionId, { type: "content_block_start", index, content_block: startOf(block) }),
    );
    events.push(streamEvent(sessionId, { type: "content_block_delta", index, delta: deltaOf(block) }));
    events.push(streamEvent(sessionId, { type: "content_block_stop", index }));
  });
  events.push(
    streamEvent(sessionId, {
      type: "message_delta",
      delta: { stop_reason: message.stopReason },
      usage: FAKE_USAGE,
    }),
    streamEvent(sessionId, { type: "message_stop" }),
  );
  for (const block of message.blocks) {
    events.push({
      type: "assistant",
      uuid: ids.uuid(),
      session_id: sessionId,
      ...(message.error && { error: message.error }),
      message: {
        id: message.id,
        model: message.model,
        role: "assistant",
        content: [block],
        stop_reason: message.stopReason,
        usage: FAKE_USAGE,
      },
    });
  }
  return events;
}

export const rateLimitEvent = (sessionId: string, limit: FakeRateLimit, uuid: string): ClaudeSdkMessage => ({
  type: "rate_limit_event",
  uuid,
  session_id: sessionId,
  rate_limit_info: {
    status: limit.status,
    rateLimitType: "five_hour",
    utilization: limit.fiveHour,
    resetsAt: limit.resetsAt,
    unifiedWindows: { five_hour: { utilization: limit.fiveHour } },
  },
});

export const toolResultEvent = (
  sessionId: string,
  toolUseId: string,
  text: string,
  isError: boolean,
  uuid: string,
): ClaudeSdkMessage => ({
  type: "user",
  uuid,
  session_id: sessionId,
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolUseId, content: text, is_error: isError }],
  },
});

export const resultEvent = (
  sessionId: string,
  model: string,
  outcome: "success" | "interrupted" | "error",
  uuid: string,
): ClaudeSdkMessage => ({
  type: "result",
  uuid,
  session_id: sessionId,
  subtype: outcome === "success" ? "success" : "error_during_execution",
  is_error: outcome !== "success",
  ...(outcome === "interrupted" && { terminal_reason: "aborted_tools" }),
  usage: FAKE_USAGE,
  modelUsage: { [model]: { ...FAKE_USAGE, contextWindow: FAKE_CONTEXT_WINDOW, costUSD: 0 } },
});

export const initEvent = (
  sessionId: string,
  model: string,
  toolNames: readonly string[],
  apiKeySource: string,
): ClaudeSdkMessage => ({
  type: "system",
  subtype: "init",
  session_id: sessionId,
  model,
  tools: toolNames,
  mcp_servers: [{ name: "tau", status: "connected" }],
  apiKeySource,
  claude_code_version: "0.0.0-fake",
});
