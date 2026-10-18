import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const TimerDeleteParameters = Type.Object({ id: Type.String() });

/** Owner C (MVP8) implements it; see MVP8.md section 4. */
export const timerDeleteToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "timer-delete",
    tools: [unimplementedTool("timer_delete", "Delete one of this thread's timers.", TimerDeleteParameters)],
  }),
});
