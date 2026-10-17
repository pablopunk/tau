import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const ProcessLogsParameters = Type.Object({ id: Type.String(), tail: Type.Optional(Type.Number()) });

export const processLogsToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "process-logs",
    tools: [
      unimplementedTool(
        "process_logs",
        "Read the last lines of a process's logs.",
        ProcessLogsParameters,
        "safe",
      ),
    ],
  }),
});
