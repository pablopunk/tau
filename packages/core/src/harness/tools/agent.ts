import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const AgentParameters = Type.Object({
  description: Type.String(),
  prompt: Type.String(),
  subagent_type: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  isolation: Type.Optional(Type.Literal("worktree")),
  run_in_background: Type.Optional(Type.Boolean()),
});

export const agentToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "agent",
    tools: [unimplementedTool("agent", "Start a subagent.", AgentParameters)],
  }),
});
