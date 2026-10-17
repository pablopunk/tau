import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const ListAgentsParameters = Type.Object({});

export const listAgentsToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "list-agents",
    tools: [unimplementedTool("list_agents", "List your subagents.", ListAgentsParameters, "safe")],
  }),
});
