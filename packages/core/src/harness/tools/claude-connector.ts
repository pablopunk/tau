import type { Context } from "@earendil-works/chord/context";
import { defineExtension, defineTool, ProviderDoc, type ToolExecutionApi } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { CONNECTOR_TOOL_NAME } from "../../claude-cli/connectors/names";
import type { ClaudeToolResult } from "../../claude-cli/sdk-types";
import type { ToolFileFactory } from "./tool-file";

export const ClaudeConnectorParameters = Type.Object({
  server: Type.String(),
  tool: Type.String(),
  arguments: Type.Record(Type.String(), Type.Unknown()),
});

const DESCRIPTION = [
  "A call to a tool of a connector (Linear, Slack, ...) that the Claude CLI already ran.",
  "The adapter writes these calls itself; the model never asks for one.",
].join(" ");

const NEVER_ABORTED = new AbortController().signal;

const signalOf = (context: Context): AbortSignal => context.abortSignal ?? NEVER_ABORTED;

const outputOf = (result: ClaudeToolResult) => ({
  output: result.content.map((block) => ({ ...block })),
  isError: result.isError,
});

async function providerSessionIdOf(api: ToolExecutionApi, context: Context): Promise<string | undefined> {
  const state = await api.snapshot(ProviderDoc, api.conversationId, context).catch(() => undefined);
  return state?.sessionId;
}

export const claudeConnectorToolFile: ToolFileFactory = (services) => ({
  implemented: false,
  extension: defineExtension({
    name: "claude-connector",
    tools: [
      defineTool({
        name: CONNECTOR_TOOL_NAME,
        description: DESCRIPTION,
        parameters: ClaudeConnectorParameters,
        replay: "safe",
        async execute(_args, api, context) {
          const { observed, interruptConversation } = services.current().claudeConnectors;
          try {
            return outputOf(await observed.wait(api.callId, signalOf(context)));
          } catch (error) {
            const sessionId = await providerSessionIdOf(api, context);
            if (sessionId) await interruptConversation(sessionId);
            throw error;
          } finally {
            observed.forget(api.callId);
          }
        },
      }),
    ],
  }),
});
