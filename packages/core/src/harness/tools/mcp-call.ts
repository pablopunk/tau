import type { JsonValue } from "@earendil-works/chord";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { projectIdOfCall } from "./mcp-project";
import { classifyMcpServer, mcpDeniedText } from "./sandbox-mcp";
import type { ToolFileFactory } from "./tool-file";

export const McpCallParameters = Type.Object({
  server: Type.String(),
  tool: Type.String(),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

type McpContent = { type: string; text?: string; data?: string; mimeType?: string };
type McpCallResult = { content?: McpContent[]; isError?: boolean };

type OutputContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function outputOf(item: McpContent): OutputContent {
  if (item.type === "image" && item.data !== undefined && item.mimeType !== undefined) {
    return { type: "image", data: item.data, mimeType: item.mimeType };
  }
  return { type: "text", text: item.text ?? JSON.stringify(item) };
}

export function mcpResultToOutput(result: McpCallResult): OutputContent[] {
  const content = (result.content ?? []).map(outputOf);
  return content.length > 0 ? content : [{ type: "text", text: "" }];
}

const errorOutput = (error: unknown) => ({
  output: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true,
});

export const mcpCallToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "mcp-call",
    tools: [
      defineTool({
        name: "mcp_call",
        description:
          "Call a tool on an MCP server. Use mcp_search first to find the server, tool and its arguments.",
        parameters: McpCallParameters,
        async execute({ server, tool, arguments: args }, api, context) {
          try {
            const sandbox = services.current().sandbox;
            if (sandbox !== undefined) {
              const scope = await sandbox.scopeOf(api.conversationId).catch(() => undefined);
              const allowlisted = await sandbox.mcpAllowed(server).catch(() => false);
              if (scope !== undefined && classifyMcpServer({ scope, allowlisted }) === "denied") {
                return errorOutput(new Error(mcpDeniedText(server, scope)));
              }
            }
            const projectId = await projectIdOfCall(api, context);
            const result = (await services
              .current()
              .mcp.call(projectId, server, tool, args ?? {})) as McpCallResult;
            const details: JsonValue = { server, tool };
            return { output: mcpResultToOutput(result), isError: result.isError === true, details };
          } catch (error) {
            return errorOutput(error);
          }
        },
      }),
    ],
  }),
});
