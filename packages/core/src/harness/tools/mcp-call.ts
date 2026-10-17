import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const McpCallParameters = Type.Object({
  server: Type.String(),
  tool: Type.String(),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

/** Phase 1 (D): `replay: "unsafe"` (the default), so an interrupted call returns `interrupted`. */
export const mcpCallToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "mcp-call",
    tools: [unimplementedTool("mcp_call", "Call a tool on an MCP server.", McpCallParameters)],
  }),
});
