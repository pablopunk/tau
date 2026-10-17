import type { Conversation, Harness, SettledTask } from "@earendil-works/pi-durable";
import { AppError } from "@pi-everywhere/protocol";
import { BACKGROUND } from "./open";

type CompactionOutcome = SettledTask<{ entryId?: unknown; submissionId?: unknown }>["state"]["outcome"];

const placedNothing = (result: { entryId?: unknown; submissionId?: unknown }) =>
  result.entryId === undefined && result.submissionId === undefined;

function requireCompacted(outcome: CompactionOutcome): void {
  switch (outcome.status) {
    case "completed":
      if (placedNothing(outcome.result)) {
        throw new AppError("nothing_to_compact", "There is nothing to compact yet.");
      }
      return;
    case "failed":
    case "faulted":
      throw new AppError("internal", outcome.error.message);
    case "aborted":
      throw new AppError("internal", "The compaction was stopped.");
    case "orphaned":
      throw new AppError("internal", outcome.reason);
  }
}

/** Starts a manual compaction and resolves once it ended with a summary placed. */
export async function compactConversation(
  harness: Harness,
  conversation: Conversation,
  instructions: string | undefined,
): Promise<void> {
  const taskId = await conversation.compact(instructions, BACKGROUND);
  const settled = await harness.waitForTask(taskId, BACKGROUND);
  requireCompacted(settled.state.outcome);
}
