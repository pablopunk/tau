import { delimiter, join } from "node:path";
import { defineExtension } from "@earendil-works/pi-durable";
import {
  type BashExecution,
  type BashPrepare,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";
import { createTauBashTool } from "./tools/bash";
import { createToolServicesRef, type ToolServicesRef } from "./tools/tool-file";

export const TAU_HOME_VARIABLE = "TAU_HOME";
export const TAU_THREAD_ID_VARIABLE = "TAU_THREAD_ID";

function addTauEnvironment(home: string | undefined, execution: BashExecution, conversationId: string) {
  execution.env[TAU_THREAD_ID_VARIABLE] = conversationId;
  if (home === undefined) return;
  execution.env[TAU_HOME_VARIABLE] = home;
  execution.env.PATH = [join(home, "bin"), process.env.PATH ?? ""].join(delimiter);
}

/** Every agent's bash knows its own thread and, when the home is known, finds `tau` on the PATH. */
export const tauShellEnvironment =
  (home: string | undefined): BashPrepare =>
  (execution, api) =>
    addTauEnvironment(home, execution, String(api.conversationId));

/** The bundled `coding-tools` (read, write, edit, bash) with the bash replaced by one that knows tau and can go to the background. */
export const createTauCodingTools = (
  home: string | undefined,
  services: ToolServicesRef = createToolServicesRef(),
) =>
  defineExtension({
    name: "coding-tools",
    tools: [
      createReadTool(),
      createWriteTool(),
      createEditTool(),
      createTauBashTool({
        services,
        prepare: (execution, conversationId) => addTauEnvironment(home, execution, conversationId),
      }),
    ],
  });
