import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const ProcessListParameters = Type.Object({});

export const processListToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "process-list",
    tools: [
      unimplementedTool(
        "process_list",
        "List this thread's background processes.",
        ProcessListParameters,
        "safe",
      ),
    ],
  }),
});
