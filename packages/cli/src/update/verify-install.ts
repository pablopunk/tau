import type { RunCommand } from "./command-runner";
import { entryOfPackage } from "./install-method";

export interface VerifyDeps {
  readonly runCommand: RunCommand;
  readonly readPackageVersion: (packageDir: string) => string | undefined;
  readonly execPath: string;
}

const STATUS_TIMEOUT_MS = 30_000;

function reportedVersion(stdout: string): string | undefined {
  try {
    return (JSON.parse(stdout.trim()) as { cliVersion?: string }).cliVersion;
  } catch {
    return undefined;
  }
}

/** The new files must say the target version and the new binary must load; returns the problem, if any. */
export async function verifyInstall(
  deps: VerifyDeps,
  packageDir: string,
  target: string,
  home: string,
): Promise<string | undefined> {
  const onDisk = deps.readPackageVersion(packageDir);
  if (onDisk !== target) return `${packageDir}/package.json says ${onDisk ?? "nothing"}, expected ${target}.`;
  const args = [entryOfPackage(packageDir), "status", "--home", home, "--json"];
  const result = await deps.runCommand(deps.execPath, args, {
    stdio: "capture",
    timeoutMs: STATUS_TIMEOUT_MS,
  });
  if (result.code !== 0)
    return `The new tau does not start (exit ${result.code}): ${result.stderr.trim().slice(0, 300)}`;
  const reported = reportedVersion(result.stdout);
  return reported === target
    ? undefined
    : `The new tau reports version ${reported ?? "unknown"}, expected ${target}.`;
}
