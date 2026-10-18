import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const ScheduleWakeupParameters = Type.Object({
  /** 60 to 86400. */
  delay_seconds: Type.Number({ minimum: 60, maximum: 86400 }),
  prompt: Type.String(),
  reason: Type.String(),
});

/** Owner C (MVP8) implements it; see MVP8.md section 4. */
export const scheduleWakeupToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "schedule-wakeup",
    tools: [
      unimplementedTool(
        "schedule_wakeup",
        "Wake this thread once after a delay with a prompt.",
        ScheduleWakeupParameters,
      ),
    ],
  }),
});
