import { GenericTool } from "./GenericTool";
import type { ToolRendererProps } from "./types";

export function TaskTool({ state }: ToolRendererProps) {
  return <GenericTool state={state} />;
}
