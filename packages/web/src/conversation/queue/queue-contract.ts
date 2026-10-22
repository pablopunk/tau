import type { FileRef, ImageInput, QueuedMessage, WhenBusy } from "@tau/protocol";

/**
 * Mirror of the frozen queue-remake contract (commit `04f6ea5`: receipts,
 * `sendNow`, `entryKind`, user-item snapshots, watch-failure frame). The
 * protocol + testkit freeze has not merged into this branch yet, so the web
 * client codes against these structural mirrors; every shape here matches the
 * frozen schemas field-for-field.
 *
 * INTEGRATOR: when the contract branch merges, delete this file and import
 * `SendReceipt`, `UserItemSnapshot`, `AbortResult`, `CancelQueuedResult`,
 * `SendNowResult` from `@tau/protocol`, and use `QueuedMessage["entryKind"]`
 * directly. `entryKindOf` stays: it is the documented position caveat for
 * pre-contract payloads.
 */
export interface SendReceipt {
  readonly submissionId: number;
  readonly entryId?: number | undefined;
}

export interface UserItemSnapshot {
  readonly text: string;
  readonly files: readonly FileRef[];
}

export interface AbortResult {
  readonly restored: readonly UserItemSnapshot[];
}

export interface CancelQueuedResult {
  readonly cancelled: boolean;
  readonly restored: readonly UserItemSnapshot[];
}

export interface SendNowResult extends SendReceipt {
  readonly restored: readonly UserItemSnapshot[];
}

/** The `conversations` RPC surface the queue UI needs. Structural: the real `Api` gains these with the freeze. */
export interface QueueConversations {
  send(
    id: string,
    input: {
      text: string;
      images?: ImageInput[];
      files?: FileRef[];
      whenBusy?: WhenBusy;
      requestId: string;
    },
    // biome-ignore lint/suspicious/noConfusingVoidType: void keeps pre-contract nodes assigning.
  ): Promise<SendReceipt | void>;
  // biome-ignore lint/suspicious/noConfusingVoidType: void keeps pre-contract nodes assigning.
  abort(id: string): Promise<AbortResult | void>;
  cancelQueued(id: string, itemId: string): Promise<CancelQueuedResult>;
  sendNow(id: string, itemId: string): Promise<SendNowResult>;
}

export function queueRpcOf(conversations: unknown): QueueConversations {
  return conversations as QueueConversations;
}

/**
 * Normalized queue-item kind. The freeze carries `entryKind` on every
 * `QueuedMessage` (`item.entry?.kind ?? "pi.user"`); every user-only op keys
 * off this, never off text matching. Pre-contract payloads have no kind and
 * read as user items, matching the protocol default.
 */
export function entryKindOf(item: Pick<QueuedMessage, "text"> & { entryKind?: string }): string {
  return item.entryKind ?? "pi.user";
}

/** Only `pi.user` items get user affordances (Cancel / Send now). Goal directives ride the same policy. */
export function isUserItem(item: Pick<QueuedMessage, "text"> & { entryKind?: string }): boolean {
  return entryKindOf(item) === "pi.user";
}

/** Steer acts at the next tool boundary; follow-up waits behind the run. */
export const STEER_COPY = "Delivered at the next tool boundary";

/**
 * Narrows a send receipt across contract generations: pre-contract nodes
 * resolve `void`, the freeze resolves a receipt. Compiles under both — a
 * bare `!== undefined` does not once the type loses `void`.
 */
export function hasReceipt(receipt: unknown): receipt is SendReceipt {
  return typeof receipt === "object" && receipt !== null && "submissionId" in receipt;
}
