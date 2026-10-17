import { GenericTool } from "./GenericTool";
import type { ToolRendererProps } from "./types";

export function TodoTool({ state }: ToolRendererProps) {
  return <GenericTool state={state} />;
}
