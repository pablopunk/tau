import { dirname, join } from "node:path";
import { isPlainVersion } from "@tau/protocol";
import type { RunCommand } from "./command-runner";

export const PACKAGE_NAME = "@pablopunk/tau";
const VIEW_TIMEOUT_MS = 15_000;

export const npmOf = (execPath: string): string => join(dirname(execPath), "npm");

/** The registry's `latest` as plain `x.y.z`; anything else is an error. */
export async function fetchLatestVersion(run: RunCommand, execPath: string): Promise<string> {
  const args = ["view", `${PACKAGE_NAME}@latest`, "version", "--prefer-online"];
  const result = await run(npmOf(execPath), args, { stdio: "capture", timeoutMs: VIEW_TIMEOUT_MS });
  if (result.code !== 0) {
    throw new Error(
      `Could not read the latest version from the npm registry (${result.stderr.trim().split("\n")[0] || `exit ${result.code}`}).`,
    );
  }
  const version = result.stdout.trim();
  if (!isPlainVersion(version)) throw new Error(`The registry returned an unexpected version: ${version}`);
  return version;
}
