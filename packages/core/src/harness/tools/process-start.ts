import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import type { ToolFileFactory } from "./tool-file";

export const ProcessStartParameters = Type.Object({
  command: Type.String(),
  name: Type.Optional(Type.String()),
});

export const processStartToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "process-start",
    tools: [
      defineTool({
        name: "process_start",
        description: "Start a long-running background process in the thread's folder, such as a dev server.",
        parameters: ProcessStartParameters,
        replay: "unsafe",
        execute: async ({ command, name }, api) => {
          const info = await services.current().processes.start({
            conversationId: String(api.conversationId),
            cwd: api.env?.cwd ?? process.cwd(),
            command,
            ...(name === undefined ? {} : { name }),
          });
          return { output: [{ type: "text", text: JSON.stringify(info) }], details: { processId: info.id } };
        },
      }),
    ],
  }),
});
