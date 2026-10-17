import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const ProcessStartParameters = Type.Object({
  command: Type.String(),
  name: Type.Optional(Type.String()),
});

/** Phase 1 (E): `replay: "unsafe"`: a crashed start becomes an interrupted result, never a second spawn. */
export const processStartToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "process-start",
    tools: [unimplementedTool("process_start", "Start a background process.", ProcessStartParameters)],
  }),
});
