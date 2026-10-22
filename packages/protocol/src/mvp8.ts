import { Type } from "typebox";
import { ProcessOriginSchema } from "./mvp5";

export const MONITOR_EVENT_KIND = "app.monitor_event";
export const PROCESS_EXIT_KIND = "app.process_exit";
export const TIMER_FIRED_KIND = "app.timer_fired";
export const NOTICE_KIND = "app.notice";
export const GOAL_VERDICT_KIND = "app.goal_verdict";
/** Display-only row for a user `!` command: admitted while busy, never sent to the model. */
export const BANG_KIND = "app.bang";

export const BangDataSchema = Type.Object({ command: Type.String() });
export type BangData = Type.Static<typeof BangDataSchema>;

export const MonitorEndSchema = Type.Union([
  Type.Object({ exitCode: Type.Union([Type.Number(), Type.Null()]) }),
  Type.Literal("timeout"),
]);

export const MonitorEventDataSchema = Type.Object({
  processId: Type.String(),
  description: Type.String(),
  lines: Type.Array(Type.String()),
  dropped: Type.Number(),
  ended: Type.Optional(MonitorEndSchema),
});
export type MonitorEventData = Type.Static<typeof MonitorEventDataSchema>;

export const ProcessExitDataSchema = Type.Object({
  processId: Type.String(),
  name: Type.String(),
  command: Type.String(),
  exitCode: Type.Union([Type.Number(), Type.Null()]),
  logTail: Type.String(),
  origin: Type.Optional(ProcessOriginSchema),
  /** Why tau stopped the command; absent for a natural exit. */
  stopReason: Type.Optional(
    Type.Union([
      Type.Literal("user"),
      Type.Literal("timeout"),
      Type.Literal("resources"),
      Type.Literal("memory"),
    ]),
  ),
});
export type ProcessExitData = Type.Static<typeof ProcessExitDataSchema>;

export const TimerSourceSchema = Type.Union([Type.Literal("agent"), Type.Literal("loop")]);
export type TimerSource = Type.Static<typeof TimerSourceSchema>;

export const TimerKindSchema = Type.Union([Type.Literal("wakeup"), Type.Literal("repeat")]);
export type TimerKind = Type.Static<typeof TimerKindSchema>;

export const TimerFiredDataSchema = Type.Object({
  timerId: Type.String(),
  kind: TimerKindSchema,
  prompt: Type.String(),
  reason: Type.Union([Type.String(), Type.Null()]),
  source: TimerSourceSchema,
  firedCount: Type.Number(),
});
export type TimerFiredData = Type.Static<typeof TimerFiredDataSchema>;

export const NoticeDataSchema = Type.Object({ text: Type.String() });
export type NoticeData = Type.Static<typeof NoticeDataSchema>;

export const GoalStateSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("paused"),
  Type.Literal("achieved"),
  Type.Literal("failed"),
  Type.Literal("cleared"),
]);
export type GoalState = Type.Static<typeof GoalStateSchema>;

export const GoalVerdictSchema = Type.Union([
  Type.Literal("not_met"),
  Type.Literal("met"),
  Type.Literal("impossible"),
]);
export type GoalVerdict = Type.Static<typeof GoalVerdictSchema>;

export const GoalVerdictDataSchema = Type.Object({
  goalId: Type.String(),
  verdict: GoalVerdictSchema,
  reason: Type.String(),
  turnsEvaluated: Type.Number(),
});
export type GoalVerdictData = Type.Static<typeof GoalVerdictDataSchema>;

export const TimerSchema = Type.Object({
  id: Type.String(),
  conversationId: Type.String(),
  kind: TimerKindSchema,
  /** The repeat interval, like "5m"; `null` for a wake-up. */
  every: Type.Union([Type.String(), Type.Null()]),
  prompt: Type.String(),
  reason: Type.Union([Type.String(), Type.Null()]),
  source: TimerSourceSchema,
  createdAt: Type.Number(),
  expiresAt: Type.Union([Type.Number(), Type.Null()]),
  nextAt: Type.Number(),
  firedCount: Type.Number(),
});
export type Timer = Type.Static<typeof TimerSchema>;

export const LoopInputSchema = Type.Object({
  every: Type.Optional(Type.String({ minLength: 1 })),
  prompt: Type.String({ minLength: 1 }),
});
export type LoopInput = Type.Static<typeof LoopInputSchema>;

export const GOAL_CONDITION_MAX_LENGTH = 4000;

export const GoalSchema = Type.Object({
  id: Type.String(),
  condition: Type.String(),
  state: GoalStateSchema,
  startedAt: Type.Number(),
  turnsEvaluated: Type.Number(),
  tokensSpent: Type.Number(),
  lastVerdict: Type.Union([GoalVerdictSchema, Type.Null()]),
  lastReason: Type.Union([Type.String(), Type.Null()]),
});
export type Goal = Type.Static<typeof GoalSchema>;

export const GoalInputSchema = Type.Object({
  condition: Type.String({ minLength: 1, maxLength: GOAL_CONDITION_MAX_LENGTH }),
});
export type GoalInput = Type.Static<typeof GoalInputSchema>;

export const GoalSummarySchema = Type.Object({ state: GoalStateSchema, condition: Type.String() });
export type GoalSummary = Type.Static<typeof GoalSummarySchema>;

/** The opening tag of the text the model reads for each notification kind; the UI hides user messages that start with one. */
export const NOTIFICATION_TAGS = [
  "subagent-notification",
  "monitor-event",
  "process-exit",
  "timer-fired",
  "notice",
  "goal-verdict",
  "todos-updated",
] as const;

export const isNotificationText = (text: string): boolean => {
  const start = text.trimStart();
  return NOTIFICATION_TAGS.some((tag) => start.startsWith(`<${tag}`));
};
