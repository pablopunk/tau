import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { indexEntryOfCall, isGoverned } from "../../processes/governor/governed";
import type { ToolFileFactory } from "./tool-file";

export const ProcessStartParameters = Type.Object({
  command: Type.String(),
  name: Type.Optional(Type.String()),
  /** Default true: tell the thread when the process exits by itself. */
  notify_on_exit: Type.Optional(Type.Boolean()),
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
        execute: async ({ command, name, notify_on_exit }, api, context) => {
          const processes = services.current().processes;
          const governed = await isGoverned(processes.resourceSettings(), indexEntryOfCall(api, context));
          const info = await processes.start({
            conversationId: String(api.conversationId),
            cwd: api.env?.cwd ?? process.cwd(),
            command,
            ...(governed && { governed }),
            ...(name === undefined ? {} : { name }),
            notifyOnExit: notify_on_exit ?? true,
          });
          return { output: [{ type: "text", text: JSON.stringify(info) }], details: { processId: info.id } };
        },
      }),
    ],
  }),
});
