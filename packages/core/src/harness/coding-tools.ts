import { delimiter, join } from "node:path";
import { defineExtension } from "@earendil-works/pi-durable";
import {
  type BashPrepare,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";

export const TAU_HOME_VARIABLE = "TAU_HOME";
export const TAU_THREAD_ID_VARIABLE = "TAU_THREAD_ID";

/** Every agent's bash knows its own thread and, when the home is known, finds `tau` on the PATH. */
export const tauShellEnvironment =
  (home: string | undefined): BashPrepare =>
  (execution, api) => {
    execution.env[TAU_THREAD_ID_VARIABLE] = String(api.conversationId);
    if (home === undefined) return;
    execution.env[TAU_HOME_VARIABLE] = home;
    execution.env.PATH = [join(home, "bin"), process.env.PATH ?? ""].join(delimiter);
  };

/** The bundled `coding-tools` (read, write, edit, bash) with the bash replaced by one that knows tau. */
export const createTauCodingTools = (home: string | undefined) =>
  defineExtension({
    name: "coding-tools",
    tools: [
      createReadTool(),
      createWriteTool(),
      createEditTool(),
      createBashTool({ prepare: tauShellEnvironment(home) }),
    ],
  });
