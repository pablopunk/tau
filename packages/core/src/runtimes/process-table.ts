import { execFile } from "node:child_process";

export interface ProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly startTime: string;
  readonly zombie: boolean;
}

export interface ProcessTable {
  /** `undefined` when the pid does not exist. Rejects when `ps` itself fails. */
  readonly find: (pid: number) => Promise<ProcessEntry | undefined>;
  readonly list: () => Promise<readonly ProcessEntry[]>;
}

const PS_COLUMNS = "pid=,ppid=,pgid=,stat=,lstart=";
const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/;

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

export function parsePsRow(line: string): ProcessEntry | undefined {
  const match = PS_ROW.exec(line);
  if (!match) return undefined;
  const [, pid, ppid, pgid, stat, startTime] = match;
  return {
    pid: Number(pid),
    ppid: Number(ppid),
    pgid: Number(pgid),
    startTime: collapseWhitespace(startTime ?? ""),
    zombie: (stat ?? "").startsWith("Z"),
  };
}

export function parsePsOutput(output: string): ProcessEntry[] {
  return output
    .split("\n")
    .map(parsePsRow)
    .filter((entry): entry is ProcessEntry => entry !== undefined);
}

interface PsResult {
  readonly stdout: string;
  readonly exitCode: number;
}

const runPs = (args: readonly string[]): Promise<PsResult> =>
  new Promise((resolve, reject) => {
    execFile(
      "ps",
      [...args],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
      (error, stdout) => {
        if (!error) return resolve({ stdout, exitCode: 0 });
        const exitCode = (error as NodeJS.ErrnoException & { code?: number | string }).code;
        if (typeof exitCode === "number" && stdout.trim() === "") return resolve({ stdout, exitCode });
        reject(error);
      },
    );
  });

async function findWithPs(pid: number): Promise<ProcessEntry | undefined> {
  const { stdout } = await runPs(["-o", PS_COLUMNS, "-p", String(pid)]);
  return parsePsOutput(stdout).find((entry) => entry.pid === pid);
}

async function listWithPs(): Promise<readonly ProcessEntry[]> {
  const { stdout } = await runPs(["-A", "-o", PS_COLUMNS]);
  return parsePsOutput(stdout);
}

export const psProcessTable: ProcessTable = { find: findWithPs, list: listWithPs };

export function descendantEntries(entries: readonly ProcessEntry[], rootPid: number): ProcessEntry[] {
  const childrenOf = new Map<number, ProcessEntry[]>();
  for (const entry of entries) childrenOf.set(entry.ppid, [...(childrenOf.get(entry.ppid) ?? []), entry]);
  const found: ProcessEntry[] = [];
  const visited = new Set<number>([rootPid]);
  const queue = [rootPid];
  for (const parent of queue) {
    for (const child of childrenOf.get(parent) ?? []) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid);
      found.push(child);
      queue.push(child.pid);
    }
  }
  return found;
}
