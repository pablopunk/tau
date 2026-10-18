import {
  MONITOR_EVENT_KIND,
  type MonitorEventData,
  NOTICE_KIND,
  PROCESS_EXIT_KIND,
  type ProcessInfo,
} from "@tau/protocol";
import type { Notification } from "../harness/notification-submitter";

const quote = (value: string) => value.replaceAll('"', "'").replaceAll("\n", " ");

export function monitorEventNotification(
  info: ProcessInfo,
  event: Pick<MonitorEventData, "lines" | "dropped" | "ended">,
  sequence: number,
): Notification {
  const data: MonitorEventData = { processId: info.id, description: info.name, ...event };
  const dropped = event.dropped > 0 ? `\n(${event.dropped} more lines dropped)` : "";
  const ended = event.ended === undefined ? "" : `\n${endText(event.ended)}`;
  const body = event.lines.join("\n");
  return {
    kind: MONITOR_EVENT_KIND,
    data,
    text: `<monitor-event id="${info.id}" description="${quote(info.name)}">\n${body}${dropped}${ended}\n</monitor-event>`,
    requestId: `monitor:${info.id}:${sequence}`,
  };
}

function endText(ended: NonNullable<MonitorEventData["ended"]>): string {
  if (ended === "timeout") return "Monitor ended: timeout.";
  return `Monitor ended: exit code ${ended.exitCode ?? "none"}.`;
}

export function processExitNotification(
  info: ProcessInfo,
  exitCode: number | null,
  logTail: string,
): Notification {
  return {
    kind: PROCESS_EXIT_KIND,
    data: { processId: info.id, name: info.name, command: info.command, exitCode, logTail },
    text: `<process-exit id="${info.id}" name="${quote(info.name)}" exit_code="${exitCode ?? "none"}">\n${logTail}\n</process-exit>`,
    requestId: `process-exit:${info.id}`,
  };
}

export const noticeNotification = (text: string, requestId: string): Notification => ({
  kind: NOTICE_KIND,
  data: { text },
  text: `<notice>${text}</notice>`,
  requestId,
});

export const noisyNoticeText = (name: string) =>
  `monitor "${quote(name)}" stopped: too noisy; filter with grep --line-buffered`;
export const restartNoticeText = (name: string) => `monitor "${quote(name)}" stopped: tau restarted`;
