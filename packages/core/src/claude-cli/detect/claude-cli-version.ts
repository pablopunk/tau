import { execFile } from "node:child_process";

const VERSION_TIMEOUT_MS = 5_000;
const VERSION_PATTERN = /\d+\.\d+\.\d+\S*/;

type Environment = Readonly<Record<string, string | undefined>>;

export const parseCliVersion = (stdout: string): string | null => VERSION_PATTERN.exec(stdout)?.[0] ?? null;

/** `TAU_CLAUDE_PATH`, else the SDK's bundled native `claude` when given, else the one on the `PATH`. */
export function readCliVersion(env: Environment, bundled?: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      env.TAU_CLAUDE_PATH ?? bundled ?? "claude",
      ["--version"],
      { timeout: VERSION_TIMEOUT_MS, env: { ...env } },
      (_error, stdout) => resolve(parseCliVersion(stdout ?? "")),
    );
  });
}
