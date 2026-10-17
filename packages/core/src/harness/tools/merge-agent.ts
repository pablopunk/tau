import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const MergeAgentParameters = Type.Object({ id: Type.String() });

export const mergeAgentToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "merge-agent",
    tools: [unimplementedTool("merge_agent", "Merge a subagent's worktree.", MergeAgentParameters)],
  }),
});
