import { describe } from "vitest";
import { accessCases } from "./access";
import { type CaseRunner, type ContractOptions, caseRunner } from "./case-runner";
import { chatCases } from "./chat";
import { checkpointCases } from "./checkpoints";
import { claudeCliCases } from "./claude-cli";
import { claudeConnectorCases } from "./claude-connectors";
import { cloneCases } from "./clone";
import { compactCases } from "./compact";
import { configureCases } from "./configure";
import { conversationCases } from "./conversations";
import { fileCases } from "./files";
import { forkCases } from "./fork";
import { fsCases } from "./fs";
import { githubCases } from "./github";
import { goalCases } from "./goals";
import { iconCases } from "./icons";
import { lifecycleCases } from "./lifecycle";
import { loginCases } from "./login";
import { mcpCases } from "./mcp";
import { monitorCases } from "./monitors";
import { nodesCases } from "./nodes";
import { nodesGroupCases } from "./nodes-group";
import { processCases } from "./processes";
import { projectCases } from "./projects";
import { providerCases } from "./providers";
import { queueCases } from "./queue";
import { remoteCases } from "./remote";
import { resourceCases } from "./resources";
import { retryCases } from "./retry";
import { settingsAndProviderCases } from "./settings-provider";
import { sidebarDataCases } from "./sidebar-data";
import { skillCases } from "./skills";
import { startCases } from "./start";
import { subagentCases } from "./subagents";
import { terminalCases } from "./terminals";
import { timerCases } from "./timers";
import { titleAndStatusCases } from "./titles-status";
import { todoCases } from "./todos";
import type { MakeContractTarget } from "./types";
import { updatesCases } from "./updates";
import { uploadCases } from "./uploads";
import { workspaceCases } from "./workspaces";

export type { ContractOptions } from "./case-runner";
export type { ContractGroup, ContractTarget, MakeContractTarget } from "./types";

type CaseModule = (makeTarget: MakeContractTarget, test: CaseRunner) => void;

/** Every contract module by name, in the order the contract has always run them. */
export const CONTRACT_MODULES = {
  settings: settingsAndProviderCases,
  resources: resourceCases,
  projects: projectCases,
  fs: fsCases,
  conversations: conversationCases,
  start: startCases,
  "titles-status": titleAndStatusCases,
  lifecycle: lifecycleCases,
  retry: retryCases,
  configure: configureCases,
  clone: cloneCases,
  chat: chatCases,
  github: githubCases,
  icons: iconCases,
  "sidebar-data": sidebarDataCases,
  provider: providerCases,
  login: loginCases,
  compact: compactCases,
  files: fileCases,
  uploads: uploadCases,
  skills: skillCases,
  workspaces: workspaceCases,
  checkpoints: checkpointCases,
  fork: forkCases,
  queue: queueCases,
  subagents: subagentCases,
  processes: processCases,
  terminals: terminalCases,
  mcp: mcpCases,
  timers: timerCases,
  todos: todoCases,
  monitors: monitorCases,
  goals: goalCases,
  "claude-cli": claudeCliCases,
  "claude-connectors": claudeConnectorCases,
  access: accessCases,
  remote: remoteCases,
  nodes: nodesCases,
  "nodes-group": nodesGroupCases,
  updates: updatesCases,
} satisfies Record<string, CaseModule>;

export type ContractModule = keyof typeof CONTRACT_MODULES;

/**
 * Behavior every `Core` must have. Run against the testkit fake (testkit's own test) and against the real core
 * in faux mode (core's test). `makeTarget` is called once per test and must give an empty, independent core.
 * Case names carry a `[tag]`; `options.pending` lists tags a target does not implement yet.
 * `modules` runs a subset, so a long contract can be split across test files that vitest runs in parallel.
 */
export function runCoreContract(
  name: string,
  makeTarget: MakeContractTarget,
  options: ContractOptions = {},
  modules: readonly ContractModule[] = Object.keys(CONTRACT_MODULES) as ContractModule[],
): void {
  const test = caseRunner(options.pending);
  describe(`Core contract: ${name}`, () => {
    for (const module of modules) CONTRACT_MODULES[module](makeTarget, test);
  });
}
