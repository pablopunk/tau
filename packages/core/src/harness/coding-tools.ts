import { delimiter, join } from "node:path";
import { defineExtension, type ToolRegistration } from "@earendil-works/pi-durable";
import {
  type BashPrepare,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";
import { createTauBashTool } from "./tools/bash";
import { assertWriteAllowed, SandboxDenied } from "./tools/sandbox-path";
import { createToolServicesRef, type ToolServicesRef } from "./tools/tool-file";

export const TAU_HOME_VARIABLE = "TAU_HOME";
export const TAU_THREAD_ID_VARIABLE = "TAU_THREAD_ID";

/** A thread's shell knows its own id and, when the home is known, finds `tau` on the PATH. */
export function addTauEnvironment(
  home: string | undefined,
  env: Record<string, string>,
  conversationId: string,
): void {
  env[TAU_THREAD_ID_VARIABLE] = conversationId;
  if (home === undefined) return;
  env[TAU_HOME_VARIABLE] = home;
  env.PATH = [join(home, "bin"), process.env.PATH ?? ""].join(delimiter);
}

/** Every agent's bash knows its own thread and, when the home is known, finds `tau` on the PATH. */
export const tauShellEnvironment =
  (home: string | undefined): BashPrepare =>
  (execution, api) =>
    addTauEnvironment(home, execution.env, String(api.conversationId));

/**
 * Layer-2 confinement for in-process file tools: Pi's `write`/`edit` never spawn, so the OS
 * sandbox cannot see them. The check runs in our code (unbypassable) against the thread's
 * canonical root; unresolvable root fails closed. Reads stay open.
 */
const confineWrites = <T extends ToolRegistration>(tool: T, services: ToolServicesRef): T => ({
  ...tool,
  execute: (async (args: unknown, api: unknown, context: unknown) => {
    const target = (args as { path?: unknown } | null)?.path;
    const sb = services.current().sandbox;
    const conversationId = (api as { conversationId?: unknown } | null)?.conversationId;
    if (typeof target === "string" && sb && conversationId !== undefined) {
      const scope = await sb.scopeOf(String(conversationId)).catch(() => undefined);
      if (scope) {
        const root = await sb.rootOf(String(conversationId)).catch(() => undefined);
        if (!root) throw new SandboxDenied(String(conversationId), "<unresolved sandbox root>");
        const env = (api as { env?: { cwd?: unknown } } | null)?.env;
        const cwd = typeof env?.cwd === "string" ? env.cwd : process.cwd();
        await assertWriteAllowed(target, root, cwd);
      }
    }
    return (tool.execute as (a: unknown, b: unknown, c: unknown) => unknown)(args, api, context);
  }) as T["execute"],
});

/** The bundled `coding-tools` (read, write, edit, bash) with the bash replaced by one that knows tau and can go to the background. */
export const createTauCodingTools = (
  home: string | undefined,
  services: ToolServicesRef = createToolServicesRef(),
) =>
  defineExtension({
    name: "coding-tools",
    tools: [
      createReadTool(),
      confineWrites(createWriteTool(), services),
      confineWrites(createEditTool(), services),
      createTauBashTool({
        services,
        prepare: (execution, conversationId) => addTauEnvironment(home, execution.env, conversationId),
      }),
    ],
  });
