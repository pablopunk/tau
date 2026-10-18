import { createRegistry } from "@earendil-works/pi-durable";
import { codingExtension } from "./coding-extension";
import { createTauCodingTools } from "./coding-tools";
import { piWebAccessToolFile } from "./pi-extension-adapter/pi-extension-adapter";
import { subagentRuntimeExtension } from "./subagent-runtime";
import { agentToolFile } from "./tools/agent";
import { listAgentsToolFile } from "./tools/list-agents";
import { mcpCallToolFile } from "./tools/mcp-call";
import { mcpSearchToolFile } from "./tools/mcp-search";
import { mergeAgentToolFile } from "./tools/merge-agent";
import { processListToolFile } from "./tools/process-list";
import { processLogsToolFile } from "./tools/process-logs";
import { processStartToolFile } from "./tools/process-start";
import { processStopToolFile } from "./tools/process-stop";
import { sendMessageToolFile } from "./tools/send-message";
import { stopAgentToolFile } from "./tools/stop-agent";
import { buildTaskToolFile, taskToolFile } from "./tools/task";
import { todoWriteToolFile } from "./tools/todo-write";
import { createToolServicesRef, type ToolFileFactory, type ToolServicesRef } from "./tools/tool-file";

export const TOOL_FILES: readonly ToolFileFactory[] = [
  taskToolFile,
  agentToolFile,
  sendMessageToolFile,
  stopAgentToolFile,
  listAgentsToolFile,
  mergeAgentToolFile,
  todoWriteToolFile,
  mcpSearchToolFile,
  mcpCallToolFile,
  processStartToolFile,
  processLogsToolFile,
  processStopToolFile,
  processListToolFile,
  piWebAccessToolFile,
];

export const LEGACY_TOOL_FILES: readonly ToolFileFactory[] = TOOL_FILES.map((file) =>
  file === taskToolFile ? buildTaskToolFile(undefined) : file,
);

export function createAgentRegistry(
  services: ToolServicesRef = createToolServicesRef(),
  toolFiles: readonly ToolFileFactory[] = TOOL_FILES,
  home?: string,
) {
  const registry = createRegistry();
  registry.install(createTauCodingTools(home));
  registry.install(codingExtension);
  registry.install(subagentRuntimeExtension);
  for (const build of toolFiles) {
    const file = build(services);
    if (file.implemented) registry.install(file.extension);
  }
  return registry;
}
