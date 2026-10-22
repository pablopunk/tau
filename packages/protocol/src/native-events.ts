import { RUNTIME_LIFECYCLES, type RuntimeLifecycle } from "./runtime";
import type { ConversationView } from "./view";

export const NATIVE_EVENT_ENTRY_KIND = "native.event";

export type NativeJsonValue =
  | string
  | number
  | boolean
  | null
  | NativeJsonValue[]
  | { [key: string]: NativeJsonValue };

export type NativeDelivery = "queue" | "steer" | "send-now";
export type NativeQueueDisposition = "queued" | "delivered" | "cancelled";

export type NativeEvent =
  | { readonly type: "session"; readonly key: string; readonly sessionId: string }
  | {
      readonly type: "user";
      readonly key: string;
      readonly requestId: string;
      readonly receiptId: string;
      readonly text: string;
      readonly delivery: NativeDelivery;
      readonly attachmentCount: number;
    }
  | {
      readonly type: "lifecycle";
      readonly key: string;
      readonly lifecycle: RuntimeLifecycle;
      readonly operationId?: string;
      readonly reason?: string;
    }
  | {
      readonly type: "queue";
      readonly key: string;
      readonly requestId: string;
      readonly disposition: NativeQueueDisposition;
    }
  | {
      readonly type: "assistant-text";
      readonly key: string;
      readonly messageId: string;
      readonly partIndex: number;
      readonly text: string;
    }
  | {
      readonly type: "assistant-thinking";
      readonly key: string;
      readonly messageId: string;
      readonly partIndex: number;
      readonly text: string;
      readonly visible: boolean;
    }
  | {
      readonly type: "tool-call";
      readonly key: string;
      readonly callId: string;
      readonly name: string;
      readonly input: NativeJsonValue;
    }
  | {
      readonly type: "tool-result";
      readonly key: string;
      readonly callId: string;
      readonly isError: boolean;
      readonly text: string;
      readonly imageCount: number;
    }
  | {
      readonly type: "usage";
      readonly key: string;
      readonly messageId: string;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cacheRead: number;
      readonly cacheWrite: number;
    }
  | {
      readonly type: "result";
      readonly key: string;
      readonly subtype: string;
      readonly isError: boolean;
      readonly text?: string;
      readonly durationMs?: number;
      readonly costUsd?: number;
      readonly sessionId: string;
    }
  | { readonly type: "notice"; readonly key: string; readonly code: string; readonly text: string };

export type NativeEventType = NativeEvent["type"];

type Fields = Readonly<Record<string, unknown>>;
type EntryLike = { readonly kind: string; readonly data?: unknown };

const DELIVERIES: readonly string[] = ["queue", "steer", "send-now"];
const DISPOSITIONS: readonly string[] = ["queued", "delivered", "cancelled"];

const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isOptional = (value: unknown, check: (value: unknown) => boolean): boolean =>
  value === undefined || check(value);
const isOneOf = (options: readonly string[]) => (value: unknown) =>
  isString(value) && options.includes(value);

const fieldChecks: Readonly<Record<NativeEventType, (fields: Fields) => boolean>> = {
  session: (f) => isString(f.sessionId),
  user: (f) =>
    isString(f.requestId) &&
    isString(f.receiptId) &&
    isString(f.text) &&
    isOneOf(DELIVERIES)(f.delivery) &&
    isNumber(f.attachmentCount),
  lifecycle: (f) =>
    isOneOf(RUNTIME_LIFECYCLES)(f.lifecycle) &&
    isOptional(f.operationId, isString) &&
    isOptional(f.reason, isString),
  queue: (f) => isString(f.requestId) && isOneOf(DISPOSITIONS)(f.disposition),
  "assistant-text": (f) => isString(f.messageId) && isNumber(f.partIndex) && isString(f.text),
  "assistant-thinking": (f) =>
    isString(f.messageId) && isNumber(f.partIndex) && isString(f.text) && isBoolean(f.visible),
  "tool-call": (f) => isString(f.callId) && isString(f.name) && f.input !== undefined,
  "tool-result": (f) =>
    isString(f.callId) && isBoolean(f.isError) && isString(f.text) && isNumber(f.imageCount),
  usage: (f) =>
    isString(f.messageId) &&
    isNumber(f.inputTokens) &&
    isNumber(f.outputTokens) &&
    isNumber(f.cacheRead) &&
    isNumber(f.cacheWrite),
  result: (f) =>
    isString(f.subtype) &&
    isBoolean(f.isError) &&
    isString(f.sessionId) &&
    isOptional(f.text, isString) &&
    isOptional(f.durationMs, isNumber) &&
    isOptional(f.costUsd, isNumber),
  notice: (f) => isString(f.code) && isString(f.text),
};

function isNativeEventType(value: unknown): value is NativeEventType {
  return isString(value) && Object.hasOwn(fieldChecks, value);
}

function isNativeEventData(data: unknown): data is NativeEvent {
  if (!isRecord(data) || !isString(data.key) || !isNativeEventType(data.type)) return false;
  return fieldChecks[data.type](data);
}

/** Undefined for any entry that is not a well-formed native event. */
export function nativeEventOf(entry: EntryLike): NativeEvent | undefined {
  if (entry.kind !== NATIVE_EVENT_ENTRY_KIND) return undefined;
  return isNativeEventData(entry.data) ? entry.data : undefined;
}

/** Entry order, malformed entries skipped, the first event of a repeated key kept. */
export function nativeEventsOf(view: ConversationView): NativeEvent[] {
  const seen = new Set<string>();
  const events: NativeEvent[] = [];
  for (const entry of view.entries ?? []) {
    const event = nativeEventOf(entry);
    if (!event || seen.has(event.key)) continue;
    seen.add(event.key);
    events.push(event);
  }
  return events;
}
