import { execFile } from "node:child_process";

const VERSION_TIMEOUT_MS = 5_000;
const VERSION_PATTERN = /\d+\.\d+\.\d+\S*/;

type Environment = Readonly<Record<string, string | undefined>>;

export const parseCliVersion = (stdout: string): string | null => VERSION_PATTERN.exec(stdout)?.[0] ?? null;

export function readCliVersion(env: Environment): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      env.TAU_CLAUDE_PATH ?? "claude",
      ["--version"],
      { timeout: VERSION_TIMEOUT_MS, env: { ...env } },
      (_error, stdout) => resolve(parseCliVersion(stdout ?? "")),
    );
  });
}
