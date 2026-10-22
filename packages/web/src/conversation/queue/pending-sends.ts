import type { FileRef, ImageInput, SendReceipt, WhenBusy } from "@tau/protocol";
import { useSyncExternalStore } from "react";

/** A composer send waiting for live state to reflect it. Keyed by the returned receipt — never by text. */
export interface PendingSend {
  /** Client key: `send-<submissionId>`, or `failed-<n>` for sends that never got a receipt. */
  readonly key: string;
  readonly conversationId: string;
  readonly submissionId?: number | undefined;
  readonly entryId?: number | undefined;
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
  receipt: SendReceipt,
  message: { text: string; images: readonly ImageInput[]; files: readonly FileRef[]; whenBusy?: WhenBusy },
): PendingSend {
  const key = `send-${receipt.submissionId}`;
  const entry: PendingSend = {
    key,
    conversationId,
    submissionId: receipt.submissionId,
    ...(receipt.entryId !== undefined && { entryId: receipt.entryId }),
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
export function hasReceipt(receipt: unknown): receipt is SendReceipt {
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
