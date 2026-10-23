import type { EntryRecord } from "@earendil-works/pi-durable";
import {
  NATIVE_EVENT_ENTRY_KIND,
  type NativeEvent,
  type NativeQueueDisposition,
  type RuntimeLifecycle,
} from "@tau/protocol";
import { type InboxItem, plainJson } from "./runtime-docs";

export type LifecycleDetails = { operationId?: string; reason?: string };

export const userEvent = (item: InboxItem): NativeEvent => ({
  type: "user",
  key: `${item.requestId}:user`,
  requestId: item.requestId,
  receiptId: item.receiptId,
  text: item.text,
  delivery: item.delivery,
  attachmentCount: item.attachmentIds.length,
});

export const queueEvent = (requestId: string, disposition: NativeQueueDisposition): NativeEvent => ({
  type: "queue",
  key: `${requestId}:${disposition}`,
  requestId,
  disposition,
});

/** The projection revision is the per-thread transition counter: unique and monotonic for every state change. */
export const lifecycleEvent = (
  revision: number,
  lifecycle: RuntimeLifecycle,
  details: LifecycleDetails = {},
): NativeEvent => ({
  type: "lifecycle",
  key: `${details.operationId ?? "thread"}:${lifecycle}:${revision}`,
  lifecycle,
  ...(details.operationId !== undefined && { operationId: details.operationId }),
  ...(details.reason !== undefined && { reason: details.reason }),
});

export const acknowledgedNotice = (operationId: string, note: string): NativeEvent => ({
  type: "notice",
  key: `${operationId}:acknowledged`,
  code: "outcome-acknowledged",
  text: `Outcome acknowledged: ${note}`,
});

export const entryDraftOf = (event: NativeEvent) => ({
  kind: NATIVE_EVENT_ENTRY_KIND,
  data: plainJson(event) as unknown as NonNullable<EntryRecord["data"]>,
});
