import { execFile } from "node:child_process";
import { AppError } from "@tau/protocol";

export interface CommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

const identity = ["-c", "user.name=tau", "-c", "user.email=tau@localhost"];

function cleanEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
  return env;
}

export function tryGit(cwd: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      [...identity, "-C", cwd, ...args],
      { env: cleanEnvironment(), timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: error === null, stdout, stderr }),
    );
  });
}

export const failureMessage = (result: CommandResult) =>
  (result.stderr.trim() || result.stdout.trim() || "git failed").slice(0, 2000);

export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await tryGit(cwd, args);
  if (!result.ok) throw new AppError("internal", failureMessage(result));
  return result.stdout;
}

export const gitLine = async (cwd: string, args: readonly string[]) => (await git(cwd, args)).trim();
