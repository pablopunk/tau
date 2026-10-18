import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { CONNECTOR_TOOL_NAME } from "../../claude-cli/connectors/names";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const ClaudeConnectorParameters = Type.Object({
  server: Type.String(),
  tool: Type.String(),
  arguments: Type.Record(Type.String(), Type.Unknown()),
});

const DESCRIPTION = [
  "A call to a tool of a connector (Linear, Slack, ...) that the Claude CLI already ran.",
  "The adapter writes these calls itself; the model never asks for one.",
].join(" ");

/** Owner A flips `implemented` and writes `execute`: await the observed result, return it unchanged, interrupt on abort. */
export const claudeConnectorToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "claude-connector",
    tools: [unimplementedTool(CONNECTOR_TOOL_NAME, DESCRIPTION, ClaudeConnectorParameters)],
  }),
});
