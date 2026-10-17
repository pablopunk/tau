import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import type { ToolFileFactory } from "./tool-file";

export const ProcessListParameters = Type.Object({});

export const processListToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "process-list",
    tools: [
      defineTool({
        name: "process_list",
        description: "List this thread's background processes.",
        parameters: ProcessListParameters,
        replay: "safe",
        execute: async (_args, api) => {
          const list = await services.current().processes.list(String(api.conversationId));
          return { output: [{ type: "text", text: JSON.stringify(list) }] };
        },
      }),
    ],
  }),
});
