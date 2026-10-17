import { GenericTool } from "./GenericTool";
import type { ToolRendererProps } from "./types";

export function ProcessTool({ state }: ToolRendererProps) {
  return <GenericTool state={state} />;
}
