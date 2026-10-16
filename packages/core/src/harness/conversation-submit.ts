import type { Conversation, Harness, InputSubmissionDraft } from "@earendil-works/pi-durable";
import { BACKGROUND } from "./open";

/** Admits the input unless its `requestId` was admitted before. Returns whether it was admitted now. */
export async function submitOnce(
  harness: Harness,
  conversation: Conversation,
  draft: InputSubmissionDraft & { readonly requestId: string },
): Promise<boolean> {
  const known = await harness.commit(
    (tx) => tx.submissionByRequest(conversation.id, draft.requestId),
    BACKGROUND,
  );
  if (known) return false;
  await conversation.submit(draft, BACKGROUND);
  return true;
}
