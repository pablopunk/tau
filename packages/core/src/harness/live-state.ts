import type { CommitPublication, ConversationId, Harness } from "@earendil-works/pi-durable";
import { LiveDoc } from "@earendil-works/pi-durable";
import { BACKGROUND } from "./open";

const LIVE_KIND = "pi.live";

export type BusyChange = { conversationId: string; busy: boolean };

export function busyChangesIn(publication: CommitPublication): BusyChange[] {
  const changes: BusyChange[] = [];
  for (const change of publication.changes) {
    if (change.type !== "document" || change.record.kind !== LIVE_KIND) continue;
    if (change.conversationId === undefined) continue;
    const run = (change.value as { run?: unknown } | null)?.run;
    changes.push({ conversationId: String(change.conversationId), busy: run !== undefined });
  }
  return changes;
}

/** The listener runs synchronously inside the commit: it must not block or call Session APIs. */
export function observeBusyChanges(harness: Harness, listener: (change: BusyChange) => void): () => void {
  return harness.subscribeCommits((publication) => {
    for (const change of busyChangesIn(publication)) listener(change);
  });
}

export async function isBusy(harness: Harness, conversationId: ConversationId): Promise<boolean> {
  const live = await harness.snapshot(LiveDoc, conversationId, BACKGROUND).catch(() => undefined);
  return live?.run !== undefined;
}

export async function lastAnswerFailed(harness: Harness, conversationId: ConversationId): Promise<boolean> {
  const conversation = await harness.conversation(conversationId, BACKGROUND);
  if (!conversation) return false;
  const { entries } = await conversation.context(BACKGROUND);
  const answer = entries.filter((entry) => entry.kind === "pi.assistant").at(-1);
  const message = answer?.model?.[0];
  return message?.role === "assistant" && message.stopReason === "error";
}
