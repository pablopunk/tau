import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { withBackground } from "../system/background";

export const GH_TIMEOUT_MS = 15_000;
export const GH_MAX_BUFFER = 8 * 1024 * 1024;

export interface GhResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Resolves for any exit code; rejects only when `gh` cannot run (`code` is `ENOENT`, `ETIMEDOUT`, ...). */
export type RunGh = (args: readonly string[]) => Promise<GhResult>;

type Environment = Readonly<Record<string, string | undefined>>;

export function ghEnvironment(base: Environment): Record<string, string> {
  const env: Record<string, string | undefined> = {
    ...base,
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    NO_COLOR: "1",
    GH_PAGER: "cat",
  };
  for (const name of ["GH_HOST", "GIT_DIR", "GIT_WORK_TREE"]) delete env[name];
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** The absolute path of `gh` on the PATH, or `undefined`; the git credential helper needs an absolute path. */
export function resolveGhPath(env: Environment): string | undefined {
  const directories = (env.PATH ?? "").split(delimiter).filter(isAbsolute);
  return directories.map((directory) => join(directory, "gh")).find(isExecutable);
}

export function createRunGh(ghPath: string | undefined, env: Environment): RunGh {
  const childEnv = ghEnvironment(env);
  return (args) =>
    new Promise((resolve, reject) => {
      const command = withBackground(ghPath ?? "gh", args, childEnv.PATH ?? "");
      execFile(
        command.file,
        [...command.args],
        { env: childEnv, timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER },
        (error, stdout, stderr) => {
          const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          if (failure?.killed) return reject(Object.assign(failure, { code: "ETIMEDOUT" }));
          if (failure && typeof failure.code !== "number") return reject(failure);
          resolve({ stdout, stderr, exitCode: typeof failure?.code === "number" ? failure.code : 0 });
        },
      );
    });
}
