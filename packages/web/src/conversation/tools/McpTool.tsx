import { GenericTool } from "./GenericTool";
import type { ToolRendererProps } from "./types";

export function McpTool({ state }: ToolRendererProps) {
  return <GenericTool state={state} />;
}
