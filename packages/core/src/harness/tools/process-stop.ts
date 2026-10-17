import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import type { ToolFileFactory } from "./tool-file";

export const ProcessStopParameters = Type.Object({ id: Type.String() });

export const processStopToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "process-stop",
    tools: [
      defineTool({
        name: "process_stop",
        description: "Stop a background process.",
        parameters: ProcessStopParameters,
        replay: "safe",
        execute: async ({ id }) => {
          await services.current().processes.stop(id);
          return { output: [{ type: "text", text: `Stopped ${id}.` }] };
        },
      }),
    ],
  }),
});
