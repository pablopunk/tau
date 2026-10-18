import { defineDoc } from "@earendil-works/pi-durable";
import type { GoalVerdict } from "@tau/protocol";

export type StoredGoalState = "active" | "paused" | "achieved" | "failed";

export type JudgingMark = { runStartEntryId: string | null; lastEntryId: string | null };

export type GoalRecord = {
  id: string;
  condition: string;
  state: StoredGoalState;
  startedAt: number;
  turnsEvaluated: number;
  tokensSpent: number;
  lastVerdict: GoalVerdict | null;
  lastReason: string | null;
  /** Runs in a row that used no tool. */
  idleRuns: number;
  /** Idle check-ins sent since the user's last message. */
  checkins: number;
  nextCheckinAt: number | null;
  /** Transient errors retried since the last good run or judge answer. */
  retries: number;
  judging?: JudgingMark;
};

export type GoalDocValue = { goal: GoalRecord | null };

/** One per thread. A fork starts without a goal. */
export const GoalDoc = defineDoc<GoalDocValue>({
  kind: "app.goal",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ goal: null }),
});
