import type { ConversationSummary } from "@pi-everywhere/protocol";

export function findFinishedRuns(
  previous: readonly ConversationSummary[] | undefined,
  next: readonly ConversationSummary[],
): ConversationSummary[] {
  if (!previous) return [];
  const before = new Map(previous.map((conversation) => [conversation.id, conversation.lastRunEndedAt]));
  return next.filter(({ id, lastRunEndedAt }) => {
    if (lastRunEndedAt === null || !before.has(id)) return false;
    return lastRunEndedAt > (before.get(id) ?? 0);
  });
}
