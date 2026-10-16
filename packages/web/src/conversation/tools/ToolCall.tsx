import type { ComponentType } from "react";
import { BashTool } from "./BashTool";
import { EditTool } from "./EditTool";
import { GenericTool } from "./GenericTool";
import { ReadTool } from "./ReadTool";
import type { ToolRendererProps } from "./types";
import { WriteTool } from "./WriteTool";

const RENDERERS: Record<string, ComponentType<ToolRendererProps>> = {
  read: ReadTool,
  write: WriteTool,
  edit: EditTool,
  bash: BashTool,
};

export function ToolCall({ state }: ToolRendererProps) {
  const Renderer = RENDERERS[state.call.name] ?? GenericTool;
  return <Renderer state={state} />;
}
