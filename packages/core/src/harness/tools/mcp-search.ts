import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import type { McpToolInfo } from "../../mcp/mcp-service";
import { projectIdOfCall } from "./mcp-project";
import type { ToolFileFactory } from "./tool-file";

export const McpSearchParameters = Type.Object({ query: Type.String() });

export function formatMcpTools(tools: McpToolInfo[]): string {
  if (tools.length === 0) return "No matching MCP tools. Try a broader query, or an empty one to list all.";
  return tools
    .map((tool) => `${tool.server}/${tool.name}: ${tool.description}\n${JSON.stringify(tool.inputSchema)}`)
    .join("\n\n");
}

export const mcpSearchToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "mcp-search",
    tools: [
      defineTool({
        name: "mcp_search",
        description:
          "Find tools on connected MCP servers by keyword. Returns each tool with its input schema; call one with mcp_call.",
        parameters: McpSearchParameters,
        replay: "safe",
        async execute({ query }, api, context) {
          try {
            const projectId = await projectIdOfCall(api, context);
            const tools = await services.current().mcp.search(projectId, query);
            return {
              output: [{ type: "text", text: formatMcpTools(tools) }],
              details: { count: tools.length },
            };
          } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            return { output: [{ type: "text", text }], isError: true };
          }
        },
      }),
    ],
  }),
});
