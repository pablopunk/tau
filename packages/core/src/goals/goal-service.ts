import { randomUUID } from "node:crypto";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import { AppError, GOAL_CONDITION_MAX_LENGTH, type Goal, type GoalVerdictData } from "@tau/protocol";
import type { ChangeEmitter } from "../change-emitter";
import { scanAppConversations } from "../harness/conversation-index";
import type { ConversationStore } from "../harness/conversation-store";
import { isBusy } from "../harness/live-state";
import type { LiveWork } from "../harness/live-work";
import type { NotificationSubmitter } from "../harness/notification-submitter";
import { withAdmissionGate } from "../harness/conversation-submit";
import { BACKGROUND } from "../harness/open";
import { type RunEnd, readRunEnd } from "../harness/run-end";
import type { Scheduler } from "../timers/scheduler-api";
import { backoffMs, classifyError, errorNotice, MAX_RETRIES } from "./error-class";
import type { GoalRecord, JudgingMark } from "./goal-doc";
import {
  appendRow,
  checkinNotification,
  continuation,
  noticeRow,
  retryNotification,
  verdictRow,
} from "./goal-rows";
import { readGoal, toGoal, updateGoal } from "./goal-store";
import type { AskJudge } from "./judge-model";
import { JUDGE_RETRY_REMINDER, JUDGE_SYSTEM_PROMPT } from "./judge-prompt";
import { judgeInput, transcriptOf } from "./judge-transcript";
import { type ParsedVerdict, parseVerdict } from "./judge-verdict";
import { analyzeRun, type Entries, lastEntryIdOf } from "./run-analysis";

const MAX_IDLE_RUNS = 3;
const MAX_CHECKINS = 3;
const MAX_CHECKIN_GROWTH = 4;
export const DEFAULT_CHECKIN_MINUTES = 30;

export interface GoalServiceDeps {
  readonly harness: Harness;
  readonly conversations: Pick<ConversationStore, "find">;
  readonly notifications: NotificationSubmitter;
  readonly scheduler: Scheduler;
  readonly liveWork: LiveWork;
  readonly ask: AskJudge;
  readonly changes: ChangeEmitter;
  readonly now: () => number;
  /** The first check-in delay; `0` turns check-ins off. */
  readonly checkinMinutes: number;
  /** Delay before retry `attempt` (0, 1, 2) of a transient error. */
  readonly backoff?: (attempt: number) => number;
}

export interface GoalService {
  set(conversationId: string, condition: string): Promise<void>;
  get(conversationId: string): Promise<Goal | null>;
  clear(conversationId: string): Promise<void>;
  /** Returns at once: the judge runs outside the status tracker's queue. */
  onRunEnded(end: RunEnd): Promise<void>;
  /** Judges again the threads whose goal was waiting for a verdict; does not wait for the judge. */
  recoverAtStartup(): Promise<void>;
  onConversationRemoved(conversationId: string): void;
  /** Aborts judge calls in flight and waits for the work started so far. */
  close(): Promise<void>;
}

export const checkinMinutesFrom = (value: string | undefined): number => {
  const minutes = value === undefined || value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_CHECKIN_MINUTES;
};

const newRecord = (condition: string, now: number): GoalRecord => ({
  id: randomUUID(),
  condition,
  state: "active",
  startedAt: now,
  turnsEvaluated: 0,
  tokensSpent: 0,
  lastVerdict: null,
  lastReason: null,
  idleRuns: 0,
  checkins: 0,
  nextCheckinAt: null,
  retries: 0,
});

const sameMark = (a: JudgingMark | undefined, b: JudgingMark) =>
  a !== undefined && a.runStartEntryId === b.runStartEntryId && a.lastEntryId === b.lastEntryId;

const idOf = (conversationId: string) => Number(conversationId) as ConversationId;
const key = (conversationId: string, what: string) => `goal:${conversationId}:${what}`;
const logFailure = (error: unknown) => console.error("tau: a goal step failed", error);

export function createGoalService(deps: GoalServiceDeps): GoalService {
  const { harness, conversations, notifications, scheduler, liveWork, ask, changes, now } = deps;
  const backoff = deps.backoff ?? backoffMs;
  const checkinMs = deps.checkinMinutes * 60_000;
  const inFlight = new Set<Promise<void>>();
  const aborter = new AbortController();
  let closed = false;

  const track = (work: Promise<void>) => {
    const tracked = work.catch(logFailure).finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);
  };

  const announce = (projectId: string | undefined) => {
    if (projectId !== undefined) changes.emit({ resource: "conversations", projectId });
  };

  const cancelTimers = (conversationId: string) => {
    for (const what of ["checkin", "retry"]) scheduler.cancel(key(conversationId, what));
  };

  async function requireThread(conversationId: string) {
    const thread = await conversations.find(conversationId);
    if (!thread) throw new AppError("not_found", "Conversation not found.");
    return thread;
  }

  /** Changes the record only while it is still this goal. */
  async function patch(conversationId: string, goalId: string, change: (goal: GoalRecord) => void) {
    const update = await updateGoal(harness, idOf(conversationId), (current) => {
      if (!current || current.id !== goalId) return undefined;
      change(current);
      return current;
    });
    if (update.written) announce(update.projectId);
    return update;
  }

  const entriesOf = async (id: ConversationId): Promise<Entries> => {
    const conversation = await harness.conversation(id, BACKGROUND);
    return conversation ? (await conversation.context(BACKGROUND)).entries : [];
  };

  const threadIsIdle = async (conversationId: string) => !(await isBusy(harness, idOf(conversationId)));

  async function clearWithNotice(conversationId: string, goal: GoalRecord, text: string) {
    const update = await updateGoal(harness, idOf(conversationId), (current) =>
      current?.id === goal.id ? null : undefined,
    );
    announce(update.projectId);
    cancelTimers(conversationId);
    await appendRow(harness, conversationId, noticeRow(text), `goal:${goal.id}:notice:cleared`);
  }

  async function pauseWithNotice(conversationId: string, goal: GoalRecord, text: string) {
    await patch(conversationId, goal.id, (current) => {
      current.state = "paused";
      delete current.judging;
      current.nextCheckinAt = null;
    });
    cancelTimers(conversationId);
    await appendRow(
      harness,
      conversationId,
      noticeRow(text),
      `goal:${goal.id}:notice:paused:${goal.turnsEvaluated}:${goal.retries}`,
    );
  }

  /** Clear, pause, or retry after `retry`, as the error class says. */
  async function handleError(
    conversationId: string,
    goal: GoalRecord,
    where: "run" | "judge",
    message: string,
    retry: () => Promise<void>,
  ) {
    const cls = classifyError(message);
    if (cls === "clear") return clearWithNotice(conversationId, goal, errorNotice(where, cls, message));
    if (cls === "pause" || goal.retries >= MAX_RETRIES) {
      return pauseWithNotice(conversationId, goal, errorNotice(where, "pause", message));
    }
    await patch(conversationId, goal.id, (current) => {
      current.retries += 1;
    });
    scheduler.scheduleAt(key(conversationId, "retry"), now() + backoff(goal.retries), async () => {
      const current = await readGoal(harness, idOf(conversationId));
      if (current?.id === goal.id && current.state === "active" && (await threadIsIdle(conversationId))) {
        await retry();
      }
    });
  }

  type Answer = { parsed: ParsedVerdict | undefined; tokens: number };

  async function askVerdict(conversationId: string, goal: GoalRecord, transcript: string): Promise<Answer> {
    const user = judgeInput(goal.condition, transcript);
    let tokens = 0;
    for (const reminder of ["", `\n\n${JUDGE_RETRY_REMINDER}`]) {
      const answer = await ask(conversationId, {
        system: JUDGE_SYSTEM_PROMPT,
        user: user + reminder,
        signal: aborter.signal,
      });
      tokens += answer.tokens;
      const parsed = parseVerdict(answer.text);
      if (parsed) return { parsed, tokens };
    }
    return { parsed: undefined, tokens };
  }

  async function judgeStale(conversationId: string, goalId: string, mark: JudgingMark) {
    const current = await readGoal(harness, idOf(conversationId));
    if (!current || current.id !== goalId || current.state !== "active" || !sameMark(current.judging, mark)) {
      return true;
    }
    if (!(await threadIsIdle(conversationId))) return true;
    return lastEntryIdOf(await entriesOf(idOf(conversationId))) !== mark.lastEntryId;
  }

  async function applyVerdict(conversationId: string, goal: GoalRecord, answer: Answer) {
    const { verdict, reason } = answer.parsed as ParsedVerdict;
    const data: GoalVerdictData = {
      goalId: goal.id,
      verdict,
      reason,
      turnsEvaluated: goal.turnsEvaluated + 1,
    };
    const record = (current: GoalRecord, state: GoalRecord["state"]) => {
      current.state = state;
      current.turnsEvaluated = data.turnsEvaluated;
      current.lastVerdict = verdict;
      current.lastReason = reason;
      current.tokensSpent += answer.tokens;
      current.retries = 0;
      delete current.judging;
    };
    if (verdict !== "not_met") {
      await appendRow(
        harness,
        conversationId,
        verdictRow(data),
        `goal:${goal.id}:${goal.turnsEvaluated}:final`,
      );
      await patch(conversationId, goal.id, (current) => {
        record(current, verdict === "met" ? "achieved" : "failed");
        current.nextCheckinAt = null;
      });
      cancelTimers(conversationId);
      return;
    }
    if (goal.idleRuns >= MAX_IDLE_RUNS) {
      await appendRow(
        harness,
        conversationId,
        verdictRow(data),
        `goal:${goal.id}:${goal.turnsEvaluated}:final`,
      );
      await patch(conversationId, goal.id, (current) => record(current, "paused"));
      await appendRow(
        harness,
        conversationId,
        noticeRow(`Goal paused: ${MAX_IDLE_RUNS} runs in a row used no tools. Send a message to resume.`),
        `goal:${goal.id}:notice:idle`,
      );
      return;
    }
    await notifications.notify(conversationId, continuation(data, goal.condition));
    await patch(conversationId, goal.id, (current) => record(current, "active"));
  }

  async function judgeNow(conversationId: string, goalId: string, runStartEntryId: string | null) {
    const id = idOf(conversationId);
    const entries = await entriesOf(id);
    const mark: JudgingMark = { runStartEntryId, lastEntryId: lastEntryIdOf(entries) };
    const marked = await patch(conversationId, goalId, (current) => {
      if (current.state === "active") current.judging = mark;
    });
    const goal = marked.goal;
    if (!marked.written || !goal || goal.state !== "active") return;
    let answer: Answer;
    try {
      answer = await askVerdict(conversationId, goal, transcriptOf(entries));
    } catch (error) {
      if (closed) return;
      const message = error instanceof Error ? error.message : String(error);
      await handleError(conversationId, goal, "judge", message, () =>
        judgeNow(conversationId, goalId, runStartEntryId),
      );
      return;
    }
    if (closed) return;
    if (await judgeStale(conversationId, goalId, mark)) {
      await patch(conversationId, goalId, (current) => {
        if (sameMark(current.judging, mark)) delete current.judging;
        current.tokensSpent += answer.tokens;
      });
      return;
    }
    if (!answer.parsed) {
      await pauseWithNotice(conversationId, goal, "Goal paused. The goal check gave no usable answer.");
      return;
    }
    await applyVerdict(conversationId, goal, answer);
  }

  async function sendCheckin(conversationId: string, goalId: string) {
    const goal = await readGoal(harness, idOf(conversationId));
    if (!goal || goal.id !== goalId || goal.state !== "active" || goal.checkins >= MAX_CHECKINS) return;
    if (!(await threadIsIdle(conversationId)) || !(await liveWork.hasLiveWork(conversationId))) return;
    await notifications.notify(conversationId, checkinNotification(goalId, goal.checkins, goal.condition));
    await patch(conversationId, goalId, (current) => {
      current.checkins += 1;
      current.nextCheckinAt = null;
    });
  }

  async function armCheckin(conversationId: string, goal: GoalRecord) {
    if (checkinMs <= 0 || goal.checkins >= MAX_CHECKINS) return;
    const delay = checkinMs * Math.min(2 ** goal.checkins, MAX_CHECKIN_GROWTH);
    const due = goal.nextCheckinAt ?? now() + delay;
    if (goal.nextCheckinAt === null) {
      await patch(conversationId, goal.id, (current) => {
        current.nextCheckinAt = due;
      });
    }
    if (due <= now()) return sendCheckin(conversationId, goal.id);
    scheduler.scheduleAt(key(conversationId, "checkin"), due, () => sendCheckin(conversationId, goal.id));
  }

  async function proceedAfterRun(conversationId: string, goal: GoalRecord, end: RunEnd, usedTool: boolean) {
    if (await liveWork.hasLiveWork(conversationId)) return armCheckin(conversationId, goal);
    const after = await patch(conversationId, goal.id, (current) => {
      current.idleRuns = usedTool ? 0 : current.idleRuns + 1;
      current.retries = 0;
    });
    if (after.goal) await judgeNow(conversationId, goal.id, end.runStartEntryId);
  }

  async function handleRunEnd(end: RunEnd) {
    const { conversationId } = end;
    const stored = await readGoal(harness, idOf(conversationId));
    if (!stored || (stored.state !== "active" && stored.state !== "paused")) return;
    const thread = await conversations.find(conversationId);
    if (!thread) return;
    if (thread.archivedAt !== null)
      return clearWithNotice(conversationId, stored, "Goal cleared: the thread was archived.");
    const facts = analyzeRun(await entriesOf(idOf(conversationId)), end.runStartEntryId);
    const accounted = await patch(conversationId, stored.id, (current) => {
      current.tokensSpent += facts.tokens;
      delete current.judging;
      if (!facts.startedByUser) return;
      current.idleRuns = 0;
      current.checkins = 0;
      current.retries = 0;
      current.nextCheckinAt = null;
      if (current.state === "paused") current.state = "active";
    });
    const goal = accounted.goal;
    if (goal?.state !== "active") return;
    if (facts.startedByUser) cancelTimers(conversationId);
    if (end.outcome === "aborted") {
      return pauseWithNotice(
        conversationId,
        goal,
        "Goal paused: you stopped the run. Send a message to resume.",
      );
    }
    if (end.outcome === "error") {
      const message = facts.errorMessage ?? "The run failed.";
      return handleError(conversationId, goal, "run", message, () =>
        notifications.notify(conversationId, retryNotification(goal.id, goal.retries, goal.condition)),
      );
    }
    await proceedAfterRun(conversationId, goal, end, facts.usedTool);
  }

  async function recoverOne(conversationId: string, goal: GoalRecord) {
    if (!(await threadIsIdle(conversationId))) return;
    if (await liveWork.hasLiveWork(conversationId)) return armCheckin(conversationId, goal);
    const end = await readRunEnd(harness, idOf(conversationId));
    if (end.outcome !== "ok") return;
    await judgeNow(conversationId, goal.id, end.runStartEntryId);
  }

  async function directive(conversationId: string, goal: GoalRecord, text: string) {
    // Through the admission gate like every other submit: a plain `pi.user`
    // directive follows the user policy in `sendNow` snapshots.
    await withAdmissionGate(conversationId, async () => {
      const conversation = await harness.conversation(idOf(conversationId), BACKGROUND);
      if (!conversation) throw new AppError("not_found", "Conversation not found.");
      await conversation.submit(
        {
          type: "input",
          content: text,
          whenBusy: "followUp",
          requestId: `goal:${goal.id}:start:${now()}`,
        },
        BACKGROUND,
      );
    });
  }

  return {
    async set(conversationId, condition) {
      const thread = await requireThread(conversationId);
      if (thread.parentId !== null) throw new AppError("invalid_request", "A subagent cannot have a goal.");
      const text = condition.trim();
      if (text === "" || text.length > GOAL_CONDITION_MAX_LENGTH) {
        throw new AppError("invalid_request", `The goal needs 1 to ${GOAL_CONDITION_MAX_LENGTH} characters.`);
      }
      const update = await updateGoal(harness, idOf(conversationId), (current) => {
        if (current?.state !== "paused" || current.condition !== text) return newRecord(text, now());
        const { judging: _dropped, ...rest } = current;
        return { ...rest, state: "active", idleRuns: 0, checkins: 0, nextCheckinAt: null, retries: 0 };
      });
      if (!update.goal) throw new AppError("not_found", "Conversation not found.");
      cancelTimers(conversationId);
      announce(update.projectId);
      await directive(conversationId, update.goal, text);
    },

    async get(conversationId) {
      await requireThread(conversationId);
      const record = await readGoal(harness, idOf(conversationId));
      return record ? toGoal(record) : null;
    },

    async clear(conversationId) {
      await requireThread(conversationId);
      const update = await updateGoal(harness, idOf(conversationId), (current) =>
        current ? null : undefined,
      );
      cancelTimers(conversationId);
      if (update.written) announce(update.projectId);
    },

    onRunEnded(end) {
      if (!closed) track(handleRunEnd(end));
      return Promise.resolve();
    },

    async recoverAtStartup() {
      for (const { id, meta } of await scanAppConversations(harness)) {
        if (meta.deletedAt !== undefined) continue;
        const goal = await readGoal(harness, id);
        if (goal?.state === "active") track(recoverOne(String(id), goal));
      }
    },

    onConversationRemoved: cancelTimers,

    async close() {
      closed = true;
      aborter.abort();
      await Promise.all([...inFlight]);
    },
  };
}
