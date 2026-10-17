import type { ComponentType } from "react";
import { BashTool } from "./BashTool";
import { EditTool } from "./EditTool";
import { GenericTool } from "./GenericTool";
import { McpTool } from "./McpTool";
import { ProcessTool } from "./ProcessTool";
import { ReadTool } from "./ReadTool";
import { TaskTool } from "./TaskTool";
import { TodoTool } from "./TodoTool";
import type { ToolRendererProps } from "./types";
import { WebTool } from "./WebTool";
import { WriteTool } from "./WriteTool";

const RENDERERS: Record<string, ComponentType<ToolRendererProps>> = {
  read: ReadTool,
  write: WriteTool,
  edit: EditTool,
  bash: BashTool,
  task: TaskTool,
  todo_write: TodoTool,
  web_search: WebTool,
  fetch_content: WebTool,
  code_search: WebTool,
  get_search_content: WebTool,
  mcp_search: McpTool,
  mcp_call: McpTool,
  process_start: ProcessTool,
  process_logs: ProcessTool,
  process_stop: ProcessTool,
  process_list: ProcessTool,
};

export function ToolCall({ state }: ToolRendererProps) {
  const Renderer = RENDERERS[state.call.name] ?? GenericTool;
  return <Renderer state={state} />;
}
