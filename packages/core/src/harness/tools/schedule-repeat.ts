import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { describeClockTime, describeDuration, parseEvery } from "../../timers/every";
import { timerIdForToolCall } from "../../timers/timer-ids";
import { addTimer } from "../../timers/timer-ops";
import type { ToolFileFactory } from "./tool-file";

export const ScheduleRepeatParameters = Type.Object({
  /** "5m", "2h" or "1d"; at least one minute. */
  every: Type.String(),
  prompt: Type.String(),
});

export const SCHEDULE_REPEAT_DESCRIPTION =
  'Wake this thread at a fixed interval ("5m", "2h", "1d"; at least 1m) with a prompt. A repeat expires after 7 days. Delete it with timer_delete when it is no longer needed.';

export const scheduleRepeatToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "schedule-repeat",
    tools: [
      defineTool({
        name: "schedule_repeat",
        description: SCHEDULE_REPEAT_DESCRIPTION,
        parameters: ScheduleRepeatParameters,
        replay: "safe",
        execute: async ({ every, prompt }, api, context) => {
          const { timers } = services.current();
          const intervalMs = parseEvery(every);
          const at = timers.now();
          const timer = await api.commit(
            (tx) =>
              addTimer(
                tx,
                api.conversationId,
                {
                  id: timerIdForToolCall(api.callId),
                  kind: "repeat",
                  every,
                  prompt,
                  reason: null,
                  source: "agent",
                  nextAt: at + intervalMs,
                },
                at,
              ),
            context,
          );
          await timers.announce(String(api.conversationId));
          const text = `Repeat ${timer.id} every ${describeDuration(intervalMs)}, next at ${describeClockTime(timer.nextAt)}, expires in 7 days.`;
          return { output: [{ type: "text", text }], details: { timerId: timer.id } };
        },
      }),
    ],
  }),
});
