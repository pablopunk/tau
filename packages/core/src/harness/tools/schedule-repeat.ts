import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const ScheduleRepeatParameters = Type.Object({
  /** "5m", "2h" or "1d"; at least one minute. */
  every: Type.String(),
  prompt: Type.String(),
});

/** Owner C (MVP8) implements it; see MVP8.md section 4. */
export const scheduleRepeatToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "schedule-repeat",
    tools: [
      unimplementedTool(
        "schedule_repeat",
        "Wake this thread at a fixed interval with a prompt.",
        ScheduleRepeatParameters,
      ),
    ],
  }),
});
