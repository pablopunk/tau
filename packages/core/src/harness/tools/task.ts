import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const TaskParameters = Type.Object({ description: Type.String(), prompt: Type.String() });

/**
 * Phase 1 (C): `tx.createConversation({ ownership: { kind: "task", taskId } })`, then `registerChildConversation`
 * (harness/conversation-child.ts) in the same tx; `replay: "safe"`, `executionMode: "parallel"`; child tools minus `task`.
 */
export const taskToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "task",
    tools: [
      unimplementedTool(
        "task",
        "Delegate a self-contained task to a subagent and get its answer.",
        TaskParameters,
        "safe",
      ),
    ],
  }),
});
