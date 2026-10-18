import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { Timer } from "@tau/protocol";
import { Type } from "typebox";
import { timersOfThread } from "../../timers/timer-ops";
import type { ToolFileFactory } from "./tool-file";

export const TimersListParameters = Type.Object({});

const describeTimer = (timer: Timer) => ({
  id: timer.id,
  kind: timer.kind,
  schedule: timer.every === null ? "once" : `every ${timer.every}`,
  nextRun: new Date(timer.nextAt).toISOString(),
  prompt: timer.prompt,
  timesFired: timer.firedCount,
  source: timer.source === "loop" ? "/loop" : "agent",
});

export const timersListToolFile: ToolFileFactory = () => ({
  implemented: true,
  extension: defineExtension({
    name: "timers-list",
    tools: [
      defineTool({
        name: "timers_list",
        description:
          "List this thread's timers: id, kind, schedule, next run, prompt, times fired and source.",
        parameters: TimersListParameters,
        replay: "safe",
        execute: async (_args, api, context) => {
          const timers = await api.commit((tx) => timersOfThread(tx, api.conversationId), context);
          const text = timers.length === 0 ? "No timers." : JSON.stringify(timers.map(describeTimer));
          return { output: [{ type: "text", text }] };
        },
      }),
    ],
  }),
});
