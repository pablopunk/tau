import type { FileRef, ImageInput, SendReceipt, WhenBusy } from "@tau/protocol";
import { useSyncExternalStore } from "react";

/** A receipt plus the request id the client minted for it, when the sender knows it. */
export type SentReceipt = SendReceipt & { readonly requestId?: string | undefined };

/** A composer send waiting for live state to reflect it. Keyed by the returned receipt — never by text. */
export interface PendingSend {
  /** Client key: `send-<submissionId>`, or `failed-<n>` for sends that never got a receipt. */
  readonly key: string;
  readonly conversationId: string;
  readonly submissionId?: number | undefined;
  readonly entryId?: number | undefined;
  /** Native threads echo it on their `user` event: the only exact id a native send can be matched on. */
  readonly requestId?: string | undefined;
  readonly text: string;
  readonly images: readonly ImageInput[];
  readonly files: readonly FileRef[];
  readonly whenBusy?: WhenBusy | undefined;
  readonly status: "sending" | "failed";
  readonly error?: string | undefined;
}

const pendings = new Map<string, PendingSend[]>();
const listeners = new Set<() => void>();
let failedCount = 0;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function forConversation(conversationId: string): PendingSend[] {
  return pendings.get(conversationId) ?? [];
}

/**
 * Registers a send the server confirmed, keyed by its receipt. Call with the
 * exact `submissionId`/`entryId?` the receipt returned; reconciliation swaps
 * on those ids only.
 */
export function noteSending(
  conversationId: string,
  receipt: SentReceipt,
  message: { text: string; images: readonly ImageInput[]; files: readonly FileRef[]; whenBusy?: WhenBusy },
): PendingSend {
  const key = `send-${receipt.submissionId}`;
  const entry: PendingSend = {
    key,
    conversationId,
    submissionId: receipt.submissionId,
    ...(receipt.entryId !== undefined && { entryId: receipt.entryId }),
    ...(receipt.requestId !== undefined && { requestId: receipt.requestId }),
    ...message,
    status: "sending",
  };
  pendings.set(conversationId, [
    ...forConversation(conversationId).filter((item) => item.key !== key),
    entry,
  ]);
  notify();
  return entry;
}

/** Registers a send that failed before any receipt: a `failed` bubble with retry, never a silent vanish. */
export function noteFailed(
  conversationId: string,
  message: { text: string; images: readonly ImageInput[]; files: readonly FileRef[]; whenBusy?: WhenBusy },
  error: string,
): PendingSend {
  failedCount += 1;
  const entry: PendingSend = {
    key: `failed-${failedCount}`,
    conversationId,
    ...message,
    status: "failed",
    error,
  };
  pendings.set(conversationId, [...forConversation(conversationId), entry]);
  notify();
  return entry;
}

export const optimisticKey = (requestId: string) => `req-${requestId}`;

function replaceEntry(
  conversationId: string,
  key: string,
  update: (entry: PendingSend) => PendingSend,
): void {
  const list = forConversation(conversationId);
  if (!list.some((item) => item.key === key)) return;
  pendings.set(
    conversationId,
    list.map((item) => (item.key === key ? update(item) : item)),
  );
  notify();
}

/**
 * Registers a send at the moment the user taps, before the server has said
 * anything: the bubble shows instantly. It carries the client `requestId`
 * only; `attachReceipt` adds the ids reconciliation matches on, in place, so
 * the row never remounts.
 */
export function noteOptimistic(
  conversationId: string,
  requestId: string,
  message: { text: string; images: readonly ImageInput[]; files: readonly FileRef[]; whenBusy?: WhenBusy },
): PendingSend {
  const key = optimisticKey(requestId);
  const entry: PendingSend = { key, conversationId, requestId, ...message, status: "sending" };
  pendings.set(conversationId, [
    ...forConversation(conversationId).filter((item) => item.key !== key),
    entry,
  ]);
  notify();
  return entry;
}

/** The server confirmed an optimistic send: attach the ids live state is reconciled on. No-op once the bubble is gone (live state beat the receipt). */
export function attachReceipt(conversationId: string, requestId: string, receipt: SendReceipt): void {
  replaceEntry(conversationId, optimisticKey(requestId), (entry) => ({
    ...entry,
    submissionId: receipt.submissionId,
    ...(receipt.entryId !== undefined && { entryId: receipt.entryId }),
  }));
}

/** An optimistic send failed: the same bubble becomes a failed one with retry, in place. */
export function failOptimistic(conversationId: string, requestId: string, error: string): void {
  replaceEntry(conversationId, optimisticKey(requestId), (entry) => ({ ...entry, status: "failed", error }));
}

/** Drops one pending entry (placed, morphed into a queued row, retried, or dismissed). */
export function resolvePending(conversationId: string, key: string): void {
  const next = forConversation(conversationId).filter((item) => item.key !== key);
  if (next.length === forConversation(conversationId).length) return;
  if (next.length === 0) pendings.delete(conversationId);
  else pendings.set(conversationId, next);
  notify();
}

/** Test-only reset. */
export function clearPending(): void {
  pendings.clear();
  listeners.clear();
  failedCount = 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Narrows a send receipt across node generations: post-contract nodes
 * resolve a receipt, pre-contract ones resolve `void`. Never treat a
 * missing receipt as failure — the live view still confirms.
 */
export function hasReceipt(receipt: unknown): receipt is SentReceipt {
  return typeof receipt === "object" && receipt !== null && "submissionId" in receipt;
}

const EMPTY: readonly PendingSend[] = [];

/** Live pending sends for one conversation. Reconcile in `Transcript`, never mutate live data here. */
export function usePendingSends(conversationId: string | undefined): readonly PendingSend[] {
  // Snapshots must be referentially stable or `useSyncExternalStore` loops.
  return useSyncExternalStore(
    subscribe,
    () => (conversationId === undefined ? EMPTY : (pendings.get(conversationId) ?? EMPTY)),
    () => EMPTY,
  );
}
