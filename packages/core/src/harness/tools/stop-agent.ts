import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const StopAgentParameters = Type.Object({ id: Type.String() });

export const stopAgentToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "stop-agent",
    tools: [unimplementedTool("stop_agent", "Stop a subagent.", StopAgentParameters)],
  }),
});
