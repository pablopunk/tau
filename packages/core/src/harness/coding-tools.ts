import { delimiter, join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { defineExtension, type ToolRegistration } from "@earendil-works/pi-durable";
import {
  type ExecutionEnv,
  err,
  FileError,
  type FileErrorCode,
  ok,
  type Result,
} from "@earendil-works/pi-durable/env";
import {
  type BashPrepare,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";
import { createTauBashTool } from "./tools/bash";
import { confinedWriteFile, SandboxDenied } from "./tools/sandbox-path";
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

const fileErrorCodes: Record<string, FileErrorCode> = {
  ABORT_ERR: "aborted",
  ENOENT: "not_found",
  EACCES: "permission_denied",
  EPERM: "permission_denied",
  ENOTDIR: "not_directory",
  EISDIR: "is_directory",
  EINVAL: "invalid",
};

const toFileError = (error: unknown, path: string): FileError => {
  const cause = error instanceof Error ? error : new Error(String(error));
  const code = fileErrorCodes[(cause as NodeJS.ErrnoException).code ?? ""] ?? "unknown";
  return new FileError(code, cause.message, path, cause);
};

const confinedWriteFileResult =
  (root: string, cwd: string) =>
  async (path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> => {
    if (context.abortSignal?.aborted) return err(new FileError("aborted", "aborted", path));
    try {
      await confinedWriteFile(path, content, root, cwd);
      return ok(undefined);
    } catch (error) {
      if (error instanceof SandboxDenied) throw error;
      return err(toFileError(error, path));
    }
  };

/** The thread's environment with `writeFile` replaced by the confined write; every other method is the original. */
const withConfinedWrites = (env: ExecutionEnv, root: string): ExecutionEnv => {
  const cwd =
    typeof (env as { cwd?: unknown }).cwd === "string" ? (env as { cwd: string }).cwd : process.cwd();
  const confinedWrite = confinedWriteFileResult(root, cwd);
  return new Proxy(env, {
    get(target, property) {
      if (property === "writeFile") return confinedWrite;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};

type ToolApi = { conversationId?: unknown; env?: ExecutionEnv } | null;

async function confinedApi(api: unknown, services: ToolServicesRef): Promise<unknown> {
  const toolApi = api as ToolApi;
  const sb = services.current().sandbox;
  if (!sb || toolApi?.conversationId === undefined || toolApi.env === undefined) return api;
  const conversationId = String(toolApi.conversationId);
  if (!(await sb.scopeOf(conversationId).catch(() => undefined))) return api;
  const root = await sb.rootOf(conversationId).catch(() => undefined);
  if (!root) throw new SandboxDenied(conversationId, "<unresolved sandbox root>");
  return { ...toolApi, env: withConfinedWrites(toolApi.env, root) };
}

/**
 * Layer-2 confinement for in-process file tools: Pi's `write`/`edit` never spawn, so the OS
 * sandbox cannot see them. Their only write is `env.writeFile`, which the tool is handed in a
 * wrapped environment that checks the thread's canonical root and writes through the validated
 * handle (best effort, see `confinedWriteFile`); unresolvable root fails closed. Reads stay open.
 */
const confineWrites = <T extends ToolRegistration>(tool: T, services: ToolServicesRef): T => ({
  ...tool,
  execute: (async (args: unknown, api: unknown, context: unknown) =>
    (tool.execute as (a: unknown, b: unknown, c: unknown) => unknown)(
      args,
      await confinedApi(api, services),
      context,
    )) as T["execute"],
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
