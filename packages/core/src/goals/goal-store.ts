import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import type { Goal, GoalSummary } from "@tau/protocol";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "../harness/conversation-docs";
import { BACKGROUND } from "../harness/open";
import { GoalDoc, type GoalRecord } from "./goal-doc";

export const toGoal = (record: GoalRecord): Goal => ({
  id: record.id,
  condition: record.condition,
  state: record.state,
  startedAt: record.startedAt,
  turnsEvaluated: record.turnsEvaluated,
  tokensSpent: record.tokensSpent,
  lastVerdict: record.lastVerdict,
  lastReason: record.lastReason,
});

const toSummary = (record: GoalRecord): GoalSummary => ({ state: record.state, condition: record.condition });

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export async function readGoal(harness: Harness, id: ConversationId): Promise<GoalRecord | null> {
  const doc = await harness.snapshot(GoalDoc, id, BACKGROUND).catch(() => undefined);
  return doc?.goal ? copy(doc.goal) : null;
}

export type GoalUpdate = { written: boolean; goal: GoalRecord | null; projectId: string | undefined };

/**
 * The one writer of a thread's goal. It changes the `app.goal` document and the index summary in one commit,
 * and does nothing for a deleted thread. `change` returns the new record, `null` to clear, or `undefined` to keep it.
 */
export function updateGoal(
  harness: Harness,
  id: ConversationId,
  change: (current: GoalRecord | null) => GoalRecord | null | undefined,
): Promise<GoalUpdate> {
  return harness.commit(async (tx): Promise<GoalUpdate> => {
    const meta = await tx.doc(ConversationDoc, id);
    const doc = await tx.doc(GoalDoc, id);
    const current = doc.goal ? copy(doc.goal) : null;
    if (meta.deletedAt !== undefined) return { written: false, goal: current, projectId: undefined };
    const next = change(current === null ? null : copy(current));
    if (next === undefined) return { written: false, goal: current, projectId: meta.projectId };
    doc.goal = next;
    const index = await tx.doc(ProjectIndexDoc, meta.projectId, INDEX_SEED);
    const entry = index.conversations.find((candidate) => candidate.conversationId === Number(id));
    if (entry && entry.deletedAt === undefined) {
      if (next === null) delete entry.goal;
      else entry.goal = toSummary(next);
    }
    return { written: true, goal: next, projectId: meta.projectId };
  }, BACKGROUND);
}
