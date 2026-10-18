import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const MonitorParameters = Type.Object({
  command: Type.String(),
  description: Type.String(),
  /** Default 300000; 0 runs until stopped. */
  timeout_ms: Type.Optional(Type.Number({ minimum: 0 })),
});

/** Owner B (MVP8) implements it; see MVP8.md section 2. */
export const monitorToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "monitor",
    tools: [
      unimplementedTool(
        "monitor",
        "Run a command in the background; each stdout line wakes you.",
        MonitorParameters,
      ),
    ],
  }),
});
