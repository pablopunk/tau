import type { Conversation, Harness, InputSubmissionDraft } from "@earendil-works/pi-durable";
import type { CancelQueuedResult, SendReceipt } from "@tau/protocol";
import { BACKGROUND } from "./open";

export interface AdmissionReceipt extends SendReceipt {
  /** False when another send with the same `requestId` won: nothing was admitted. */
  readonly admitted: boolean;
}

export function entryOfSubmission(status: { readonly entry?: unknown }): number | undefined {
  return typeof status.entry === "number" ? status.entry : undefined;
}

/** Admits the input unless its `requestId` was admitted before. Duplicates return the existing receipt. */
export async function submitOnce(
  harness: Harness,
  conversation: Conversation,
  draft: InputSubmissionDraft & { readonly requestId: string },
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

export async function cancelQueued(
  harness: Harness,
  _conversation: Conversation,
  itemId: string,
): Promise<CancelQueuedResult> {
  const result = await harness.abortSubmission(Number(itemId) as never, BACKGROUND);
  return { cancelled: result === "aborted", restored: [] };
}
