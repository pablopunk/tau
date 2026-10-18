import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import { NOTICE_KIND, TIMER_FIRED_KIND } from "@tau/protocol";
import type { Notification } from "../harness/notification-submitter";
import { BACKGROUND } from "../harness/open";
import {
  nextSlot,
  removeTimersWhere,
  syncSummaries,
  threadStateOf,
  timersOfThreadId,
  timerWithId,
} from "./timer-ops";
import { ProjectTimersDoc, TIMERS_SEED, type TimerRecord } from "./timers-doc";

export const fireRequestId = (timer: Pick<TimerRecord, "id" | "firedCount">) =>
  `timer:${timer.id}:${timer.firedCount}`;

export function timerFiredNotification(timer: TimerRecord): Notification {
  const reason = timer.reason === null || timer.reason === "" ? "" : `Reason: ${timer.reason}\n\n`;
  return {
    kind: TIMER_FIRED_KIND,
    data: {
      timerId: timer.id,
      kind: timer.kind,
      prompt: timer.prompt,
      reason: timer.reason,
      source: timer.source,
      firedCount: timer.firedCount,
    },
    text: `<timer-fired id="${timer.id}" kind="${timer.kind}" source="${timer.source}">\n${reason}${timer.prompt}\n</timer-fired>`,
    requestId: fireRequestId(timer),
  };
}

export const expiredNotice = (timer: TimerRecord): Notification => ({
  kind: NOTICE_KIND,
  data: { text: `Repeat ${timer.id} expired after 7 days.` },
  text: `<notice>Repeat ${timer.id} ("${timer.prompt}") expired after 7 days and was removed.</notice>`,
  requestId: `timer-expired:${timer.id}`,
});

export type Claim =
  | { kind: "skip" }
  /** The timer, or its thread, was removed in the claim commit. */
  | { kind: "removed"; conversationIds: string[] }
  | { kind: "expired"; timer: TimerRecord }
  | { kind: "coalesced"; conversationId: string }
  | { kind: "fire"; timer: TimerRecord };

/** Fire steps 1 and 2: read the timer again, skip a deleted or archived thread, coalesce while the last fire is queued. */
export function claimTimer(
  harness: Harness,
  projectId: string,
  timerId: string,
  now: number,
): Promise<Claim> {
  return harness.commit(async (tx): Promise<Claim> => {
    const { timers } = await tx.doc(ProjectTimersDoc, projectId, TIMERS_SEED);
    const timer = timers.find(timerWithId(timerId));
    if (!timer) return { kind: "skip" };
    const threadId = Number(timer.conversationId);
    if ((await threadStateOf(tx, projectId, threadId)) !== "live") {
      await removeTimersWhere(tx, projectId, timersOfThreadId(timer.conversationId));
      return { kind: "removed", conversationIds: [timer.conversationId] };
    }
    if (timer.expiresAt !== null && now >= timer.expiresAt) {
      const [expired] = await removeTimersWhere(tx, projectId, timerWithId(timerId));
      return expired ? { kind: "expired", timer: expired } : { kind: "skip" };
    }
    if (now < timer.nextAt) return { kind: "skip" };
    if (timer.lastFireRequestId !== null) {
      const last = await tx.submissionByRequest(threadId as ConversationId, timer.lastFireRequestId);
      if (last?.status === "queued") {
        timer.nextAt = nextSlot(timer, now);
        await syncSummaries(tx, projectId, timers, [threadId]);
        return { kind: "coalesced", conversationId: timer.conversationId };
      }
    }
    return { kind: "fire", timer: { ...timer } };
  }, BACKGROUND);
}

/** Fire step 4: count the fire and move `nextAt` (or remove a one-shot). */
export function settleFire(
  harness: Harness,
  projectId: string,
  fired: TimerRecord,
  now: number,
): Promise<void> {
  return harness.commit(async (tx) => {
    const { timers } = await tx.doc(ProjectTimersDoc, projectId, TIMERS_SEED);
    const timer = timers.find(timerWithId(fired.id));
    if (!timer) return;
    if (timer.kind === "wakeup") {
      await removeTimersWhere(tx, projectId, timerWithId(fired.id));
      return;
    }
    timer.lastFireRequestId = fireRequestId(fired);
    timer.firedCount = fired.firedCount + 1;
    timer.nextAt = nextSlot(timer, now);
    await syncSummaries(tx, projectId, timers, [Number(timer.conversationId)]);
  }, BACKGROUND);
}

/** Removes every timer of threads that were archived or deleted; returns the affected thread ids. */
export function sweepGoneThreads(harness: Harness, projectId: string): Promise<string[]> {
  return harness.commit(async (tx) => {
    const { timers } = await tx.doc(ProjectTimersDoc, projectId, TIMERS_SEED);
    const gone: string[] = [];
    for (const threadId of new Set(timers.map((timer) => timer.conversationId))) {
      if ((await threadStateOf(tx, projectId, Number(threadId))) !== "live") gone.push(threadId);
    }
    if (gone.length > 0)
      await removeTimersWhere(tx, projectId, (timer) => gone.includes(timer.conversationId));
    return gone;
  }, BACKGROUND);
}
