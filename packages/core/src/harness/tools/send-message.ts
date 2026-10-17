import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { childIdOf, requireOwnSubagent } from "../subagent-own";
import { startReporter } from "../subagent-runtime";
import { SEND_MESSAGE_DESCRIPTION } from "./agent-description";
import type { ToolFileFactory } from "./tool-file";

export const SendMessageParameters = Type.Object({
  to: Type.String(),
  message: Type.String(),
  mode: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("followUp")])),
});

export const sendMessageToolFile: ToolFileFactory = () => ({
  implemented: true,
  extension: defineExtension({
    name: "send-message",
    tools: [
      defineTool({
        name: "send_message",
        description: SEND_MESSAGE_DESCRIPTION,
        parameters: SendMessageParameters,
        replay: "unsafe",
        executionMode: "parallel",
        execute: async ({ to, message, mode }, api, context) => {
          const child = await api.commit((tx) => requireOwnSubagent(tx, api.conversationId, to), context);
          const followUp = mode !== "steer";
          await startReporter(api, context, { childId: childIdOf(child), message, followUp });
          const text = `Message sent to subagent ${to}. Its answer will arrive as a notification. Do not poll.`;
          return { output: [{ type: "text", text }] };
        },
      }),
    ],
  }),
});
