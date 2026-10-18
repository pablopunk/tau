import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { describeClockTime, describeDuration } from "../../timers/every";
import { timerIdForToolCall } from "../../timers/timer-ids";
import { addTimer } from "../../timers/timer-ops";
import type { ToolFileFactory } from "./tool-file";

export const ScheduleWakeupParameters = Type.Object({
  /** 60 to 86400. */
  delay_seconds: Type.Number({ minimum: 60, maximum: 86400 }),
  prompt: Type.String(),
  reason: Type.String(),
});

export const SCHEDULE_WAKEUP_DESCRIPTION =
  "Wake this thread once after a delay (60 to 86400 seconds) with a prompt. Use it to check back on something later instead of polling. The prompt arrives as a notification when the time comes.";

export const scheduleWakeupToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "schedule-wakeup",
    tools: [
      defineTool({
        name: "schedule_wakeup",
        description: SCHEDULE_WAKEUP_DESCRIPTION,
        parameters: ScheduleWakeupParameters,
        replay: "safe",
        execute: async ({ delay_seconds, prompt, reason }, api, context) => {
          const { timers } = services.current();
          const delayMs = Math.round(delay_seconds) * 1000;
          const at = timers.now();
          const timer = await api.commit(
            (tx) =>
              addTimer(
                tx,
                api.conversationId,
                {
                  id: timerIdForToolCall(api.callId),
                  kind: "wakeup",
                  every: null,
                  prompt,
                  reason,
                  source: "agent",
                  nextAt: at + delayMs,
                },
                at,
              ),
            context,
          );
          await timers.announce(String(api.conversationId));
          const text = `Wake-up ${timer.id} at ${describeClockTime(timer.nextAt)} (in ${describeDuration(timer.nextAt - at)}).`;
          return { output: [{ type: "text", text }], details: { timerId: timer.id } };
        },
      }),
    ],
  }),
});
