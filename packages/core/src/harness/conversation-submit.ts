import type { JsonValue } from "@earendil-works/chord";
import type {
  Conversation,
  ConversationId,
  Harness,
  SubmissionDraft,
  UserInput,
} from "@earendil-works/pi-durable";
import { InboxDoc } from "@earendil-works/pi-durable";
import {
  AppError,
  type CancelQueuedResult,
  type SendReceipt,
  type SetQueuedModeResult,
  type UserItemSnapshot,
  type WhenBusy,
} from "@tau/protocol";
import { isBusy } from "./live-state";
import { BACKGROUND } from "./open";

export interface AdmissionReceipt extends SendReceipt {
  /** False when another send with the same `requestId` won: nothing was admitted. */
  readonly admitted: boolean;
}

export function entryOfSubmission(status: { readonly entry?: unknown }): number | undefined {
  return typeof status.entry === "number" ? status.entry : undefined;
}

/**
 * The one per-conversation admission gate. Every submit path (`send`/`retry`,
 * notification delivery, timers, goal directives, subagent reporters, child
 * tool submits) holds it only through the `conversation.submit` admission, so
 * a racing notification can never slip between `sendNow`'s snapshot and its
 * abort. `sendNow` holds it across snapshot → abort → re-admit via the
 * explicitly unlocked `submitUnlocked` below.
 */
const gates = new Map<string, Promise<void>>();

export async function withAdmissionGate<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const previous = gates.get(conversationId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  gates.set(conversationId, current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (gates.get(conversationId) === current) gates.delete(conversationId);
  }
}

/**
 * Admission without the gate: only for callers that already hold it (the
 * `sendNow` re-admit path). Everyone else uses `submitOnce`.
 */
export async function submitUnlocked(
  harness: Harness,
  conversation: Conversation,
  draft: SubmissionDraft & { readonly requestId: string },
): Promise<AdmissionReceipt> {
  const known = await harness.commit(
    (tx) => tx.submissionByRequest(conversation.id, draft.requestId),
    BACKGROUND,
  );
  if (known) return { admitted: false, submissionId: known.id, entryId: entryOfSubmission(known) };
  const submission = await conversation.submit(draft, BACKGROUND);
  const status = await submission.status(BACKGROUND);
  return { admitted: true, submissionId: submission.id, entryId: entryOfSubmission(status) };
}

/** Admits the input unless its `requestId` was admitted before. Duplicates return the existing receipt. */
export async function submitOnce(
  harness: Harness,
  conversation: Conversation,
  draft: SubmissionDraft & { readonly requestId: string },
): Promise<AdmissionReceipt> {
  return withAdmissionGate(String(conversation.id), () => submitUnlocked(harness, conversation, draft));
}

/** A queued input the abort helper must decide about. `entryKind` mirrors `QueuedMessage.entryKind`. */
export interface QueuedSnapshot {
  readonly id: number;
  readonly mode: "steer" | "followUp" | "write";
  readonly content: UserInput;
  readonly entryKind: string;
  readonly entry?: { readonly kind: string; readonly data?: JsonValue };
  readonly requestId?: string;
}

const entryKindOf = (item: { mode: string; entry?: { kind: string } | undefined }): string =>
  item.mode === "write" ? "write" : (item.entry?.kind ?? "pi.user");

/** Plain user content (steers included): everything the composer may restore. */
export function isUserItem(item: Pick<QueuedSnapshot, "mode" | "entryKind">): boolean {
  return item.mode !== "write" && item.entryKind === "pi.user";
}

/** Notifications withdrawn by an abort: everything that is not plain user content. */
export function isNotificationItem(item: QueuedSnapshot): item is QueuedSnapshot & {
  readonly entry: NonNullable<QueuedSnapshot["entry"]>;
} {
  return item.mode !== "write" && item.entry !== undefined && item.entryKind !== "pi.user";
}

/**
 * The requestId-keyed sidecar for composer snapshots. Admission flattens
 * refs into text blocks, so a durable user item carries only `content`;
 * every composer-return path (Cancel, Stop, Send-now's unselected items)
 * restores the exact original text plus refs from here. Without it the
 * composer would get the flattened blocks back and duplicate them on re-send.
 */
const userItemSnapshots = new Map<string, UserItemSnapshot>();

/** Records the pre-flatten snapshot under both the admission `requestId` and submission id. */
export function rememberUserItem(requestId: string, submissionId: number, snapshot: UserItemSnapshot): void {
  userItemSnapshots.set(requestId, { text: snapshot.text, files: [...snapshot.files] });
  userItemSnapshots.set(String(submissionId), { text: snapshot.text, files: [...snapshot.files] });
}

/** Content-derived text when no sidecar entry exists: drops flattened attachment blocks. */
function derivedText(content: UserInput): string {
  if (typeof content === "string") return content;
  return content
    .flatMap((part) =>
      typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
        ? [String((part as { text?: unknown }).text ?? "")]
        : [],
    )
    .filter((text) => !text.startsWith("Attached file:"))
    .join("");
}

export function snapshotUserItem(item: QueuedSnapshot): UserItemSnapshot {
  const keyed =
    (item.requestId !== undefined ? userItemSnapshots.get(item.requestId) : undefined) ??
    userItemSnapshots.get(String(item.id));
  if (keyed) return { text: keyed.text, files: [...keyed.files] };
  return { text: derivedText(item.content), files: [] };
}

/** Reads the inbox before an abort: submission records keep no content, so this must precede it. */
export async function snapshotQueued(
  harness: Harness,
  conversationId: ConversationId,
): Promise<QueuedSnapshot[]> {
  const items = await harness.commit(async (tx) => {
    const inbox = await tx.doc(InboxDoc, conversationId);
    // Clone inside the commit: drafts are settled overlays once it returns.
    const raw = JSON.parse(JSON.stringify(inbox.items)) as Array<{
      id: number;
      mode: string;
      content: UserInput;
      entry?: QueuedSnapshot["entry"];
    }>;
    return raw.flatMap((item) => {
      if (item.mode === "write") return [];
      return [
        {
          id: Number(item.id),
          mode: item.mode as QueuedSnapshot["mode"],
          content: item.content,
          entry: item.entry,
        },
      ];
    });
  }, BACKGROUND);
  const snapshots: QueuedSnapshot[] = [];
  for (const item of items) {
    let requestId: string | undefined;
    try {
      const submission = await harness.submission(item.id as never, BACKGROUND);
      requestId = (await submission?.status(BACKGROUND))?.requestId;
    } catch {
      requestId = undefined;
    }
    snapshots.push({
      ...item,
      entryKind: entryKindOf(item),
      ...(requestId === undefined ? {} : { requestId }),
    });
  }
  return snapshots;
}

/**
 * The one-at-a-time bang slot, keyed by conversation. Reserved before
 * admission under the gate and held until the exit, a spawn failure, or
 * restart recovery — never released at spawn return. Memory-only: a restart
 * starts empty, and the boot sweep owns recovery (marked bangs are never
 * re-run, so an empty slot cannot double-execute).
 */
const bangSlots = new Map<string, string>();

export function takeBangSlot(conversationId: string, requestId: string): boolean {
  if (bangSlots.has(conversationId)) return false;
  bangSlots.set(conversationId, requestId);
  return true;
}

export function releaseBangSlot(conversationId: string): void {
  bangSlots.delete(conversationId);
}

export function bangSlotHolder(conversationId: string): string | undefined {
  return bangSlots.get(conversationId);
}

/**
 * Holds until the admitted run actually starts (bounded). Admission places
 * the entry synchronously, but the run starts asynchronously after it — and
 * a notification admitted in between would steal the idle slot and start
 * its own run first. `sendNow` keeps the gate until the run is observed so
 * the chosen message deterministically wins.
 */
export async function waitForRunStart(harness: Harness, conversationId: ConversationId): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await isBusy(harness, conversationId).catch(() => true))) {
    if (Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Server-minted admission ids: never reused, so re-admission under a known id is never a silent no-op. */
let mintedCounter = 0;
export function mintServerRequestId(prefix: string, conversationId: string, itemId: number): string {
  mintedCounter += 1;
  return `${prefix}:${conversationId}:${itemId}:${Date.now()}:${mintedCounter}`;
}

export interface AbortRestore {
  /** User items for the composer; notifications were re-admitted server-side. */
  readonly restored: UserItemSnapshot[];
}

/**
 * Shared abort helper for plain Stop and `sendNow`: under the gate it
 * snapshots queued items, aborts, then re-admits non-`pi.user` items with new
 * requestIds so no notification is lost. Notifications return as passive
 * writes — appended to the transcript without starting a run, so a Stop stays
 * stopped. User items stay withdrawn for the caller to restore to the composer.
 */
export async function abortAndRestore(
  harness: Harness,
  conversation: Conversation,
  conversationId: string,
): Promise<AbortRestore> {
  return withAdmissionGate(conversationId, async () => {
    const queued = await snapshotQueued(harness, conversation.id);
    const restored = queued.filter(isUserItem).map(snapshotUserItem);
    await conversation.abort(BACKGROUND);
    for (const item of queued) {
      if (!isNotificationItem(item)) continue;
      await submitUnlocked(harness, conversation, {
        type: "write",
        entry: {
          kind: item.entry.kind,
          ...(item.entry.data !== undefined && { data: item.entry.data as never }),
          model: [{ role: "user", content: item.content } as never],
        },
        requestId: mintServerRequestId("reattempt", conversationId, item.id),
      });
    }
    return { restored };
  });
}

export async function setQueuedMode(
  harness: Harness,
  conversation: Conversation,
  itemId: string,
  mode: WhenBusy,
): Promise<SetQueuedModeResult> {
  const queued = await snapshotQueued(harness, conversation.id);
  const item = queued.find((candidate) => String(candidate.id) === itemId);
  // A notification id never switches mode: the composer could not restore it and the queue would lose it.
  if (item && !isUserItem(item)) throw new AppError("invalid_request", "Only user messages can be switched.");
  if (!item) {
    // Scoped by conversation: a foreign item id reports `not_found`, while an item this thread
    // already delivered reports `switched: false` so the client can toast "too late" instead.
    const submission = await harness.submission(Number(itemId) as never, BACKGROUND).catch(() => undefined);
    const record = await submission?.status(BACKGROUND).catch(() => undefined);
    if (record && record.conversationId === conversation.id) return { switched: false };
    throw new AppError("not_found", `No queued item ${itemId}.`);
  }
  if (item.mode === mode) return { switched: true };
  // In-place mutation: the boundary reads `mode` lazily, so no abort or re-admission is needed and
  // the item keeps its submission id (and inbox position). Atomic with boundary commits either way.
  await harness.commit(async (tx) => {
    const inbox = await tx.doc(InboxDoc, conversation.id);
    const target = inbox.items.find((candidate) => candidate.id === (Number(itemId) as never));
    if (!target) throw new AppError("not_found", `No queued item ${itemId}.`);
    if (target.mode !== "steer" && target.mode !== "followUp")
      throw new AppError("invalid_request", "Only user messages can be switched.");
    target.mode = mode;
  }, BACKGROUND);
  return { switched: true };
}

export async function cancelQueued(
  harness: Harness,
  conversation: Conversation,
  conversationId: string,
  itemId: string,
): Promise<CancelQueuedResult> {
  const queued = await snapshotQueued(harness, conversation.id);
  const item = queued.find((candidate) => String(candidate.id) === itemId);
  // A notification id never cancels: the composer could not restore it and the queue would lose it.
  if (item && !isUserItem(item))
    throw new AppError("invalid_request", "Only user messages can be cancelled.");
  // The `conversationId` check is the cross-thread guard: a foreign item id reports `not_found`.
  const result = await harness.abortSubmission(
    Number(itemId) as never,
    BACKGROUND,
    Number(conversationId) as typeof conversation.id,
  );
  // Unknown here, or another thread's (the `conversationId` check): nothing may cancel by a foreign id.
  if (result === "not_found") throw new AppError("not_found", `No queued item ${itemId}.`);
  if (result !== "aborted") return { cancelled: false, restored: [] };
  return { cancelled: true, restored: item ? [snapshotUserItem(item)] : [] };
}
