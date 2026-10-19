import { join } from "node:path";
import type { RunCommand } from "./command-runner";
import { PACKAGE_NAME } from "./latest-version";

const ROOT_TIMEOUT_MS = 15_000;

/** `npm root -g` / `pnpm root -g`: the global node_modules folder, or undefined when the manager does not answer. */
export async function globalRoot(
  run: RunCommand,
  command: string,
  env?: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const result = await run(command, ["root", "-g"], { stdio: "capture", timeoutMs: ROOT_TIMEOUT_MS, env });
  const root = result.stdout.trim();
  return result.code === 0 && root ? root : undefined;
}

/** Where the global tau lives under a global root (not resolved: it may not exist yet). */
export const globalPackagePath = (root: string): string => join(root, PACKAGE_NAME);

/** The real directory of the globally installed tau; undefined when the root or the package is missing. */
export async function globalPackageDir(
  deps: { readonly runCommand: RunCommand; readonly realpath: (path: string) => string },
  command: string,
  env?: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const root = await globalRoot(deps.runCommand, command, env);
  if (root === undefined) return undefined;
  try {
    return deps.realpath(globalPackagePath(root));
  } catch {
    return undefined;
  }
}
