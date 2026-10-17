import { GenericTool } from "./GenericTool";
import type { ToolRendererProps } from "./types";

export function WebTool({ state }: ToolRendererProps) {
  return <GenericTool state={state} />;
}
