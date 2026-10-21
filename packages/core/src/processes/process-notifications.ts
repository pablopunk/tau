import {
  MONITOR_EVENT_KIND,
  type MonitorEventData,
  NOTICE_KIND,
  PROCESS_EXIT_KIND,
  type ProcessExitData,
  type ProcessInfo,
} from "@tau/protocol";
import type { Notification } from "../harness/notification-submitter";
import type { StopReason } from "./process-types";

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

/**
 * Fallback for a timed-out entry with no `timeoutMs` (older callers). Bang passes its scaled kill-guard,
 * so the notice names the real deadline; other reasons keep the text their call sites compose.
 */
export const BANG_TIMEOUT_LINE = "Timed out after 120 s.";

export function processExitNotification(
  info: ProcessInfo,
  exitCode: number | null,
  logTail: string,
  stopReason?: StopReason,
): Notification {
  const data: ProcessExitData = {
    processId: info.id,
    name: info.name,
    command: info.command,
    exitCode,
    logTail,
    ...(stopReason === undefined ? {} : { stopReason }),
  };
  return {
    kind: PROCESS_EXIT_KIND,
    data,
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
