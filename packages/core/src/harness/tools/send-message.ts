import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const SendMessageParameters = Type.Object({
  to: Type.String(),
  message: Type.String(),
  mode: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("followUp")])),
});

export const sendMessageToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "send-message",
    tools: [unimplementedTool("send_message", "Message a subagent.", SendMessageParameters)],
  }),
});
