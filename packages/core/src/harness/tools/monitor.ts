import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { callScopes, indexEntryOfCall, scopeFields } from "../../processes/governor/governed";
import type { ToolFileFactory } from "./tool-file";

export const DEFAULT_MONITOR_TIMEOUT_MS = 300_000;

export const MonitorParameters = Type.Object({
  command: Type.String(),
  description: Type.String(),
  /** Default 300000; 0 runs until stopped. */
  timeout_ms: Type.Optional(Type.Number({ minimum: 0 })),
});

const DESCRIPTION = [
  "Run a command in the background; each stdout line arrives as a notification, so you do not poll.",
  "Filter the output with `grep --line-buffered` and match failure lines too, not only success.",
  "Many lines in one second are batched (at most 20); more than 30 notifications in a minute stop the monitor.",
  "Stop it with process_stop.",
].join(" ");

export const monitorToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "monitor",
    tools: [
      defineTool({
        name: "monitor",
        description: DESCRIPTION,
        parameters: MonitorParameters,
        replay: "unsafe",
        execute: async ({ command, description, timeout_ms }, api, context) => {
          const processes = services.current().processes;
          const scopes = await callScopes(
            processes.resourceSettings(),
            processes.sandboxSettings(),
            indexEntryOfCall(api, context),
          );
          const info = await processes.start({
            conversationId: String(api.conversationId),
            cwd: api.env?.cwd ?? process.cwd(),
            command,
            ...scopeFields(scopes),
            name: description,
            kind: "monitor",
            timeoutMs: timeout_ms ?? DEFAULT_MONITOR_TIMEOUT_MS,
          });
          return {
            output: [
              {
                type: "text",
                text: `Monitor ${info.id} started. Each stdout line arrives as a notification. Stop it with process_stop.`,
              },
            ],
            details: { processId: info.id },
          };
        },
      }),
    ],
  }),
});
