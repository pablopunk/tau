import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function parentTable(): Promise<Map<number, number[]>> {
  const listing = execFileAsync("/bin/ps", ["-axo", "pid=,ppid="]);
  const ownPsPid = listing.child.pid;
  const { stdout } = await listing;
  const table = new Map<number, number[]>();
  for (const line of stdout.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid)) continue;
    if (pid === ownPsPid) continue;
    table.set(ppid, [...(table.get(ppid) ?? []), pid]);
  }
  return table;
}

const collect = (pid: number, table: Map<number, number[]>): number[] =>
  (table.get(pid) ?? []).flatMap((child) => [child, ...collect(child, table)]);

/** Every process below `rootPid`, found through the parent table; without the `ps` of this very call. */
export async function descendantsOf(rootPid: number = process.pid): Promise<Set<number>> {
  return new Set(collect(rootPid, await parentTable()));
}

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Share of one core this process used over `windowMs` of wall time, in percent. */
export async function cpuPercentOver(windowMs: number): Promise<number> {
  const startedAt = performance.now();
  const before = process.cpuUsage();
  await sleep(windowMs);
  const used = process.cpuUsage(before);
  const wallMicros = (performance.now() - startedAt) * 1000;
  return Math.round(((used.user + used.system) / wallMicros) * 100 * 100) / 100;
}
