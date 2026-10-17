import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const ProcessStopParameters = Type.Object({ id: Type.String() });

export const processStopToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "process-stop",
    tools: [unimplementedTool("process_stop", "Stop a background process.", ProcessStopParameters)],
  }),
});
