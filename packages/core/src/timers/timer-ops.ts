import type { ConversationId, Tx } from "@earendil-works/pi-durable";
import { AppError, type Timer, type TimerKind, type TimerSource } from "@tau/protocol";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "../harness/conversation-docs";
import { parseEvery } from "./every";
import { ProjectTimersDoc, TIMERS_SEED, type TimerRecord, toTimer } from "./timers-doc";

export const MAX_TIMERS_PER_THREAD = 20;
export const REPEAT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type NewTimer = {
  id: string;
  kind: TimerKind;
  every: string | null;
  prompt: string;
  reason: string | null;
  source: TimerSource;
  nextAt: number;
};

const threadNotFound = () => new AppError("not_found", "Conversation not found.");

export type ThreadState = "live" | "archived" | "gone";

export async function threadStateOf(tx: Tx, projectId: string, conversationId: number): Promise<ThreadState> {
  const id = conversationId as ConversationId;
  if (!(await tx.conversation(id))) return "gone";
  if ((await tx.doc(ConversationDoc, id)).deletedAt !== undefined) return "gone";
  const index = await tx.doc(ProjectIndexDoc, projectId, INDEX_SEED);
  const entry = index.conversations.find((candidate) => candidate.conversationId === conversationId);
  if (!entry || entry.deletedAt !== undefined) return "gone";
  return entry.archivedAt === undefined ? "live" : "archived";
}

/** Copies the thread's timer count and earliest next run into its index entry, so the summary needs no timers read. */
export async function syncSummaries(
  tx: Tx,
  projectId: string,
  timers: readonly TimerRecord[],
  threads: readonly number[],
) {
  const index = await tx.doc(ProjectIndexDoc, projectId, INDEX_SEED);
  for (const threadId of new Set(threads)) {
    const entry = index.conversations.find((candidate) => candidate.conversationId === threadId);
    if (!entry) continue;
    const mine = timers.filter((timer) => Number(timer.conversationId) === threadId);
    entry.timers = mine.length;
    if (mine.length === 0) delete entry.nextTimerAt;
    else entry.nextTimerAt = Math.min(...mine.map((timer) => timer.nextAt));
  }
}

async function liveProjectOf(tx: Tx, conversationId: ConversationId): Promise<string> {
  if (!(await tx.conversation(conversationId))) throw threadNotFound();
  const meta = await tx.doc(ConversationDoc, conversationId);
  if (meta.projectId === "" || meta.deletedAt !== undefined) throw threadNotFound();
  return meta.projectId;
}

/** Idempotent by `spec.id`: a rerun of the same tool call finds its timer. */
export async function addTimer(
  tx: Tx,
  conversationId: ConversationId,
  spec: NewTimer,
  now: number,
): Promise<Timer> {
  const projectId = await liveProjectOf(tx, conversationId);
  const { timers } = await tx.doc(ProjectTimersDoc, projectId, TIMERS_SEED);
  const existing = timers.find((timer) => timer.id === spec.id);
  if (existing) return toTimer(existing);
  const ofThread = timers.filter((timer) => Number(timer.conversationId) === conversationId);
  if (ofThread.length >= MAX_TIMERS_PER_THREAD) {
    throw new AppError("invalid_request", `A thread can have at most ${MAX_TIMERS_PER_THREAD} timers.`);
  }
  const record: TimerRecord = {
    ...spec,
    conversationId: String(conversationId),
    createdAt: now,
    expiresAt: spec.kind === "repeat" ? now + REPEAT_LIFETIME_MS : null,
    firedCount: 0,
    lastFireRequestId: null,
  };
  timers.push(record);
  await syncSummaries(tx, projectId, timers, [conversationId]);
  return toTimer(record);
}

export async function timersOfThread(tx: Tx, conversationId: ConversationId): Promise<Timer[]> {
  const projectId = await liveProjectOf(tx, conversationId);
  const { timers } = await tx.doc(ProjectTimersDoc, projectId, TIMERS_SEED);
  return timers
    .filter((timer) => Number(timer.conversationId) === conversationId)
    .map(toTimer)
    .sort((a, b) => a.nextAt - b.nextAt);
}

/** Removes the matching timers of one project; returns the removed ones. */
export async function removeTimersWhere(
  tx: Tx,
  projectId: string,
  matches: (timer: TimerRecord) => boolean,
): Promise<TimerRecord[]> {
  const { timers } = await tx.doc(ProjectTimersDoc, projectId, TIMERS_SEED);
  const removed = timers.filter(matches).map((timer) => ({ ...timer }));
  if (removed.length === 0) return [];
  const kept = timers.filter((timer) => !matches(timer)).map((timer) => ({ ...timer }));
  timers.splice(0, timers.length, ...kept);
  await syncSummaries(
    tx,
    projectId,
    timers,
    removed.map((timer) => Number(timer.conversationId)),
  );
  return removed;
}

export const timerWithId = (id: string) => (timer: TimerRecord) => timer.id === id;
export const ownTimerWithId = (id: string, conversationId: string) => (timer: TimerRecord) =>
  timer.id === id && timer.conversationId === conversationId;
export const loopTimersOf = (conversationId: string) => (timer: TimerRecord) =>
  timer.conversationId === conversationId && timer.source === "loop";
export const timersOfThreadId = (conversationId: string) => (timer: TimerRecord) =>
  timer.conversationId === conversationId;

/** The next slot of a repeat after `now`; a repeat that was missed keeps its schedule instead of catching up. */
export function nextSlot(timer: Pick<TimerRecord, "every" | "nextAt">, now: number): number {
  const interval = parseEvery(timer.every ?? "");
  if (now < timer.nextAt) return timer.nextAt;
  return timer.nextAt + (Math.floor((now - timer.nextAt) / interval) + 1) * interval;
}
