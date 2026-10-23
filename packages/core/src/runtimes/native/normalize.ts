import { createHash } from "node:crypto";
import type { JsonValue, NativeEvent } from "./events";

export interface NormalizerState {
  sessionId?: string;
  seen?: Set<string>;
}

export const createNormalizerState = (): NormalizerState => ({ seen: new Set() });

type Json = Record<string, unknown>;

const SILENT_SYSTEM_SUBTYPES: ReadonlySet<string> = new Set(["status", "session_title_changed"]);
const UNKNOWN_SESSION = "unknown-session";

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const countOf = (value: unknown): number => numberOf(value) ?? 0;

function canonicalJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "unserializable";
  }
}

function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}

interface Context {
  readonly sessionId: string;
  readonly uuid: string;
}

const partKey = (context: Context, partIndex: number): string =>
  `${context.sessionId}:${context.uuid}:${partIndex}`;

const notice = (key: string, code: string, text: string): NativeEvent => ({
  type: "notice",
  key,
  code,
  text,
});

function contextOf(message: Json, state: NormalizerState): Context {
  const sessionId = stringOf(message.session_id) ?? state.sessionId ?? UNKNOWN_SESSION;
  const apiMessage = isRecord(message.message) ? message.message : {};
  const uuid = stringOf(message.uuid) ?? stringOf(apiMessage.id) ?? contentHash(message);
  return { sessionId, uuid };
}

function malformedBlock(context: Context, partIndex: number, why: string): NativeEvent {
  return notice(partKey(context, partIndex), "malformed-block", `Skipped a content block: ${why}.`);
}

function thinkingEvent(context: Context, messageId: string, partIndex: number, block: Json): NativeEvent {
  const text = typeof block.thinking === "string" ? block.thinking : "";
  return {
    type: "assistant-thinking",
    key: partKey(context, partIndex),
    messageId,
    partIndex,
    text,
    visible: block.type === "thinking" && text.length > 0,
  };
}

function assistantBlockEvent(
  context: Context,
  messageId: string,
  partIndex: number,
  block: unknown,
): NativeEvent | undefined {
  if (!isRecord(block)) return malformedBlock(context, partIndex, "not an object");
  const key = partKey(context, partIndex);
  if (block.type === "text") {
    if (typeof block.text !== "string") return malformedBlock(context, partIndex, "text block without text");
    return { type: "assistant-text", key, messageId, partIndex, text: block.text };
  }
  if (block.type === "thinking" || block.type === "redacted_thinking") {
    return thinkingEvent(context, messageId, partIndex, block);
  }
  if (block.type === "tool_use") {
    const callId = stringOf(block.id);
    const name = stringOf(block.name);
    if (!callId || !name) return malformedBlock(context, partIndex, "tool_use without id or name");
    return { type: "tool-call", key, callId, name, input: (block.input ?? {}) as JsonValue };
  }
  return notice(key, "unsupported-block", `Unsupported assistant content block: ${String(block.type)}.`);
}

function usageEvent(context: Context, messageId: string, usage: unknown): NativeEvent | undefined {
  if (!isRecord(usage)) return undefined;
  return {
    type: "usage",
    key: `${context.sessionId}:${messageId}:usage`,
    messageId,
    inputTokens: countOf(usage.input_tokens),
    outputTokens: countOf(usage.output_tokens),
    cacheRead: countOf(usage.cache_read_input_tokens),
    cacheWrite: countOf(usage.cache_creation_input_tokens),
  };
}

function normalizeAssistant(message: Json, context: Context): NativeEvent[] {
  const apiMessage = isRecord(message.message) ? message.message : undefined;
  if (!apiMessage || !Array.isArray(apiMessage.content)) {
    return [
      notice(
        `${context.sessionId}:${context.uuid}:body`,
        "malformed-message",
        "Assistant message without content.",
      ),
    ];
  }
  const messageId = stringOf(apiMessage.id) ?? context.uuid;
  const blocks = apiMessage.content.map((block, index) =>
    assistantBlockEvent(context, messageId, index, block),
  );
  const usage = usageEvent(context, messageId, apiMessage.usage);
  return [...blocks, usage].filter((event): event is NativeEvent => event !== undefined);
}

function toolResultContent(content: unknown): { text: string; imageCount: number } {
  if (typeof content === "string") return { text: content, imageCount: 0 };
  if (!Array.isArray(content)) return { text: "", imageCount: 0 };
  const parts = content.filter(isRecord);
  const texts = parts.filter((part) => part.type === "text" && typeof part.text === "string");
  return {
    text: texts.map((part) => part.text as string).join("\n"),
    imageCount: parts.filter((part) => part.type === "image").length,
  };
}

function toolResultEvent(context: Context, partIndex: number, block: Json): NativeEvent {
  const callId = stringOf(block.tool_use_id);
  if (!callId) return malformedBlock(context, partIndex, "tool_result without tool_use_id");
  return {
    type: "tool-result",
    key: partKey(context, partIndex),
    callId,
    isError: block.is_error === true,
    ...toolResultContent(block.content),
  };
}

function normalizeUser(message: Json, context: Context): NativeEvent[] {
  const apiMessage = isRecord(message.message) ? message.message : undefined;
  const content = apiMessage?.content;
  if (!Array.isArray(content)) return [];
  const events: NativeEvent[] = [];
  content.forEach((block, index) => {
    if (!isRecord(block)) events.push(malformedBlock(context, index, "not an object"));
    else if (block.type === "tool_result") events.push(toolResultEvent(context, index, block));
  });
  return events;
}

function resultText(message: Json): string | undefined {
  if (typeof message.result === "string") return message.result;
  if (!Array.isArray(message.errors)) return undefined;
  const errors = message.errors.filter((entry): entry is string => typeof entry === "string");
  return errors.length > 0 ? errors.join("\n") : undefined;
}

function normalizeResult(message: Json, context: Context): NativeEvent[] {
  const subtype = stringOf(message.subtype) ?? "unknown";
  const text = resultText(message);
  const durationMs = numberOf(message.duration_ms);
  const costUsd = numberOf(message.total_cost_usd);
  return [
    {
      type: "result",
      key: `${context.sessionId}:${context.uuid}:result`,
      subtype,
      isError: message.is_error === true || subtype !== "success",
      ...(text !== undefined && { text }),
      ...(durationMs !== undefined && { durationMs }),
      ...(costUsd !== undefined && { costUsd }),
      sessionId: context.sessionId,
    },
  ];
}

function normalizeSystem(message: Json, context: Context, state: NormalizerState): NativeEvent[] {
  const subtype = stringOf(message.subtype);
  if (subtype === "init") {
    const sessionId = stringOf(message.session_id);
    if (!sessionId)
      return [notice(`${context.uuid}:init`, "malformed-message", "System init without session_id.")];
    state.sessionId = sessionId;
    return [{ type: "session", key: `${sessionId}:init`, sessionId }];
  }
  if (subtype === "permission_denied") return [permissionDeniedNotice(message, context)];
  if (subtype !== undefined && SILENT_SYSTEM_SUBTYPES.has(subtype)) return [];
  return [unknownMessageNotice(message, context)];
}

function permissionDeniedNotice(message: Json, context: Context): NativeEvent {
  const tool = stringOf(message.tool_name) ?? "a tool";
  const reason = stringOf(message.message) ?? "no reason given";
  return notice(
    `${context.sessionId}:${context.uuid}:permission-denied`,
    "permission-denied",
    `Permission denied for ${tool}: ${reason}`,
  );
}

function unknownMessageNotice(message: Json, context: Context): NativeEvent {
  const kind = [stringOf(message.type), stringOf(message.subtype)].filter(Boolean).join("/");
  return notice(
    `${context.sessionId}:${context.uuid}:unknown`,
    "unknown-message",
    `Unrecognised SDK message: ${kind || "no type"}.`,
  );
}

function eventsOf(message: Json, state: NormalizerState): NativeEvent[] {
  const context = contextOf(message, state);
  switch (message.type) {
    case "system":
      return normalizeSystem(message, context, state);
    case "assistant":
      return normalizeAssistant(message, context);
    case "user":
      return normalizeUser(message, context);
    case "result":
      return normalizeResult(message, context);
    case "stream_event":
      return [];
    default:
      return [unknownMessageNotice(message, context)];
  }
}

function unseen(events: NativeEvent[], state: NormalizerState): NativeEvent[] {
  const { seen } = state;
  if (!seen) return events;
  return events.filter((event) => {
    if (seen.has(event.key)) return false;
    seen.add(event.key);
    return true;
  });
}

export function normalizeSdkMessage(message: unknown, state: NormalizerState): NativeEvent[] {
  if (!isRecord(message)) {
    const key = `${state.sessionId ?? UNKNOWN_SESSION}:raw:${contentHash(message)}`;
    return unseen([notice(key, "malformed-message", "SDK message is not an object.")], state);
  }
  try {
    return unseen(eventsOf(message, state), state);
  } catch (error) {
    const key = `${state.sessionId ?? UNKNOWN_SESSION}:error:${contentHash(message)}`;
    const text = `Could not normalize an SDK message: ${error instanceof Error ? error.message : String(error)}`;
    return unseen([notice(key, "normalize-failed", text)], state);
  }
}
