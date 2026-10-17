import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const McpSearchParameters = Type.Object({ query: Type.String() });

/** Phase 1 (D): `services.current().mcp.search(projectId, query)`; failures are tool errors. */
export const mcpSearchToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "mcp-search",
    tools: [
      unimplementedTool("mcp_search", "Find tools on connected MCP servers.", McpSearchParameters, "safe"),
    ],
  }),
});
