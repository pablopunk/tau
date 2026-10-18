import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const TimersListParameters = Type.Object({});

/** Owner C (MVP8) implements it; see MVP8.md section 4. */
export const timersListToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "timers-list",
    tools: [unimplementedTool("timers_list", "List this thread's timers.", TimersListParameters, "safe")],
  }),
});
