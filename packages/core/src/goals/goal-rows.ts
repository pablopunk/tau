import type { Harness } from "@earendil-works/pi-durable";
import { GOAL_VERDICT_KIND, type GoalVerdictData, NOTICE_KIND, type NoticeData } from "@tau/protocol";
import { type Notification, ThreadGoneError } from "../harness/notification-submitter";
import { BACKGROUND } from "../harness/open";

/** Appends a row to the transcript without asking the model anything. A repeated `requestId` is a no-op. */
export async function appendRow(
  harness: Harness,
  conversationId: string,
  entry: { kind: string; data: GoalVerdictData | NoticeData },
  requestId: string,
): Promise<void> {
  const conversation = await harness.conversation(Number(conversationId) as never, BACKGROUND);
  if (!conversation) throw new ThreadGoneError(conversationId);
  await conversation.submit({ type: "write", entry, requestId } as never, BACKGROUND);
}

export const verdictRow = (data: GoalVerdictData) => ({ kind: GOAL_VERDICT_KIND, data });

export const noticeRow = (text: string) => ({ kind: NOTICE_KIND, data: { text } });

export const continuation = (data: GoalVerdictData, condition: string): Notification => ({
  kind: GOAL_VERDICT_KIND,
  data,
  text: `<goal-verdict>Goal not met yet: ${data.reason}. Keep working toward: ${condition}</goal-verdict>`,
  requestId: `goal:${data.goalId}:${data.turnsEvaluated - 1}`,
});

export const checkinNotification = (goalId: string, number: number, condition: string): Notification => ({
  kind: NOTICE_KIND,
  data: { text: "Goal check-in: background work is still running." },
  text: `<notice>Goal check-in: background work is still running. Check on it and keep working toward: ${condition}</notice>`,
  requestId: `goal:${goalId}:checkin:${number}`,
});

export const retryNotification = (goalId: string, number: number, condition: string): Notification => ({
  kind: NOTICE_KIND,
  data: { text: "Goal retry: the last run hit a temporary error." },
  text: `<notice>The last run hit a temporary error. Keep working toward: ${condition}</notice>`,
  requestId: `goal:${goalId}:retry:${number}`,
});
