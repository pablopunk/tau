import type { ConversationView, RuntimeLifecycle } from "@tau/protocol";
import { NATIVE_EVENT_ENTRY_KIND } from "@tau/protocol";

type EventData = Record<string, unknown> & { key: string; type: string };

export function nativeView(events: readonly EventData[]): ConversationView {
  const entries = events.map((data, index) => ({ id: index + 1, kind: NATIVE_EVENT_ENTRY_KIND, data }));
  return { conversation: { id: 7 }, entries, docs: {} } as unknown as ConversationView;
}

export const userEvent = (key: string, requestId: string, text: string): EventData => ({
  key,
  type: "user",
  requestId,
  receiptId: `receipt-${requestId}`,
  text,
  delivery: "queue",
  attachmentCount: 0,
});

export const lifecycleEvent = (key: string, lifecycle: RuntimeLifecycle, reason?: string): EventData => ({
  key,
  type: "lifecycle",
  lifecycle,
  ...(reason !== undefined && { reason }),
});

export const queueEvent = (
  key: string,
  requestId: string,
  disposition: "queued" | "delivered" | "cancelled",
): EventData => ({ key, type: "queue", requestId, disposition });

export const assistantTextEvent = (key: string, text: string): EventData => ({
  key,
  type: "assistant-text",
  messageId: `message-${key}`,
  partIndex: 0,
  text,
});
