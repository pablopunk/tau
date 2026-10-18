import { execFile } from "node:child_process";

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const IDENTITY = {
  GIT_AUTHOR_NAME: "tau",
  GIT_AUTHOR_EMAIL: "checkpoints@tau.invalid",
  GIT_COMMITTER_NAME: "tau",
  GIT_COMMITTER_EMAIL: "checkpoints@tau.invalid",
};

export type GitRun = {
  readonly cwd: string;
  readonly indexFile?: string;
};

export function runGitBuffer(run: GitRun, args: readonly string[]): Promise<Buffer> {
  const env = { ...process.env, ...IDENTITY, ...(run.indexFile && { GIT_INDEX_FILE: run.indexFile }) };
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd: run.cwd, env, encoding: "buffer", maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`git ${args[0]} failed: ${stderr.toString().trim() || error.message}`));
        else resolve(stdout);
      },
    );
  });
}

export async function runGit(run: GitRun, args: readonly string[]): Promise<string> {
  return (await runGitBuffer(run, args)).toString("utf8");
}
