import { createRegistry } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { codingExtension } from "./coding-extension";
import { piWebAccessToolFile } from "./pi-extension-adapter/pi-extension-adapter";
import { mcpCallToolFile } from "./tools/mcp-call";
import { mcpSearchToolFile } from "./tools/mcp-search";
import { processListToolFile } from "./tools/process-list";
import { processLogsToolFile } from "./tools/process-logs";
import { processStartToolFile } from "./tools/process-start";
import { processStopToolFile } from "./tools/process-stop";
import { taskToolFile } from "./tools/task";
import { todoWriteToolFile } from "./tools/todo-write";
import { createToolServicesRef, type ToolFileFactory, type ToolServicesRef } from "./tools/tool-file";

const TOOL_FILES: readonly ToolFileFactory[] = [
  taskToolFile,
  todoWriteToolFile,
  mcpSearchToolFile,
  mcpCallToolFile,
  processStartToolFile,
  processLogsToolFile,
  processStopToolFile,
  processListToolFile,
  piWebAccessToolFile,
];

export function createAgentRegistry(services: ToolServicesRef = createToolServicesRef()) {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(codingExtension);
  for (const build of TOOL_FILES) {
    const file = build(services);
    if (file.implemented) registry.install(file.extension);
  }
  return registry;
}
