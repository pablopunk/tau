import {
  BANG_KIND,
  type BangData,
  BangDataSchema,
  GOAL_VERDICT_KIND,
  type GoalVerdictData,
  GoalVerdictDataSchema,
  isNotificationText,
  MONITOR_EVENT_KIND,
  type MonitorEventData,
  MonitorEventDataSchema,
  NOTICE_KIND,
  type NoticeData,
  NoticeDataSchema,
  PROCESS_EXIT_KIND,
  type ProcessExitData,
  ProcessExitDataSchema,
  SUBAGENT_NOTIFICATION_KIND,
  type SubagentNotificationData,
  SubagentNotificationDataSchema,
  TIMER_FIRED_KIND,
  type TimerFiredData,
  TimerFiredDataSchema,
} from "@tau/protocol";
import { Value } from "typebox/value";

export const isSubagentNotificationKind = (kind: string): boolean => kind === SUBAGENT_NOTIFICATION_KIND;

export function parseSubagentNotification(data: unknown): SubagentNotificationData | undefined {
  return Value.Check(SubagentNotificationDataSchema, data) ? data : undefined;
}

export const isNotificationMarkerText = isNotificationText;

export const notificationVerb = (status: SubagentNotificationData["status"]): string =>
  status === "done" ? "finished" : status;

/** The transcript items that MVP8 notification entries turn into, one per kind. */
export type MvpNotificationItem =
  | { readonly kind: "monitor-event"; readonly data: MonitorEventData }
  | { readonly kind: "process-exit"; readonly data: ProcessExitData }
  | { readonly kind: "timer-fired"; readonly data: TimerFiredData }
  | { readonly kind: "notice"; readonly data: NoticeData }
  | { readonly kind: "goal-verdict"; readonly data: GoalVerdictData }
  | { readonly kind: "bang"; readonly data: BangData };

const parsers = {
  [BANG_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(BangDataSchema, data) ? { kind: "bang", data } : undefined,
  [MONITOR_EVENT_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(MonitorEventDataSchema, data) ? { kind: "monitor-event", data } : undefined,
  [PROCESS_EXIT_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(ProcessExitDataSchema, data) ? { kind: "process-exit", data } : undefined,
  [TIMER_FIRED_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(TimerFiredDataSchema, data) ? { kind: "timer-fired", data } : undefined,
  [NOTICE_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(NoticeDataSchema, data) ? { kind: "notice", data } : undefined,
  [GOAL_VERDICT_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(GoalVerdictDataSchema, data) ? { kind: "goal-verdict", data } : undefined,
} as const;

export function parseMvpNotification(entryKind: string, data: unknown): MvpNotificationItem | undefined {
  const parse = (parsers as Record<string, (data: unknown) => MvpNotificationItem | undefined>)[entryKind];
  return parse?.(data);
}
