import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writePrivateFile } from "./private-files";

export interface RunningInstance {
  readonly pid: number;
  readonly port: number;
}

const instancePath = (home: string) => join(home, "server.json");

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isRunningInstance(value: unknown): value is RunningInstance {
  const candidate = value as Partial<RunningInstance> | null;
  return Number.isInteger(candidate?.pid) && Number.isInteger(candidate?.port);
}

/** The instance that already serves this home, if its process is still alive. */
export async function findRunningInstance(
  home: string,
  isAlive: (pid: number) => boolean = isProcessAlive,
): Promise<RunningInstance | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(instancePath(home), "utf8"));
    return isRunningInstance(value) && isAlive(value.pid) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function recordRunningInstance(home: string, instance: RunningInstance): Promise<void> {
  await writePrivateFile(instancePath(home), JSON.stringify(instance));
}

export async function forgetRunningInstance(home: string): Promise<void> {
  await rm(instancePath(home), { force: true });
}
