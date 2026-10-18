import { GoalVerdictRow } from "./GoalVerdictRow";
import { MonitorEventRow } from "./MonitorEventRow";
import { NoticeRow } from "./NoticeRow";
import type { MvpNotificationItem } from "./notification-entry";
import { ProcessExitRow } from "./ProcessExitRow";
import { TimerFiredRow } from "./TimerFiredRow";

/** The one place that maps an MVP8 notification item to its row, so owners only edit their own row file. */
export function MvpNotificationRow({ item }: { item: MvpNotificationItem }) {
  if (item.kind === "monitor-event") return <MonitorEventRow data={item.data} />;
  if (item.kind === "process-exit") return <ProcessExitRow data={item.data} />;
  if (item.kind === "timer-fired") return <TimerFiredRow data={item.data} />;
  if (item.kind === "goal-verdict") return <GoalVerdictRow data={item.data} />;
  return <NoticeRow data={item.data} />;
}

const MVP_KINDS: readonly string[] = [
  "monitor-event",
  "process-exit",
  "timer-fired",
  "notice",
  "goal-verdict",
];

export const isMvpNotificationItem = <T extends { readonly kind: string }>(
  item: T,
): item is Extract<T, MvpNotificationItem> => MVP_KINDS.includes(item.kind);
