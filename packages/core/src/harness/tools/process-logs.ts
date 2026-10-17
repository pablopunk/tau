import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import type { ToolFileFactory } from "./tool-file";

export const ProcessLogsParameters = Type.Object({ id: Type.String(), tail: Type.Optional(Type.Number()) });

const DEFAULT_TAIL_LINES = 100;

export const processLogsToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "process-logs",
    tools: [
      defineTool({
        name: "process_logs",
        description: "Read the last lines of a process's logs.",
        parameters: ProcessLogsParameters,
        replay: "safe",
        execute: async ({ id, tail }) => {
          const text = await services.current().processes.logs(id, tail ?? DEFAULT_TAIL_LINES);
          return { output: [{ type: "text", text: text || "(no output yet)" }] };
        },
      }),
    ],
  }),
});
