import { execFile } from "node:child_process";

const REMOTE_URL_LINE = /^remote\..*\.url\s+(.+)$/;

const withoutRepositoryOverrides = (env: NodeJS.ProcessEnv) => {
  const clean = { ...env };
  delete clean.GIT_DIR;
  delete clean.GIT_WORK_TREE;
  return clean;
};

const parseRemoteUrls = (output: string) =>
  output
    .split("\n")
    .map((line) => REMOTE_URL_LINE.exec(line)?.[1]?.trim())
    .filter((url): url is string => url !== undefined && url !== "");

/** Every remote URL of the repository in `directory`; empty when it has none or `git` fails. */
export function readRemoteUrls(directory: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", directory, "config", "--get-regexp", "^remote\\..*\\.url$"],
      { env: withoutRepositoryOverrides(process.env), timeout: 10_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? [] : parseRemoteUrls(stdout)),
    );
  });
}
