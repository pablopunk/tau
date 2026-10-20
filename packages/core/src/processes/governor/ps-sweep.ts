import { type Exec, execCommand } from "./exec";
import { PROBE_TIMEOUT_MS } from "./resource-support";

export interface ProcRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly rssKb: number;
  /** `lstart` in the C locale with whitespace collapsed: `Thu Oct 15 10:25:50 2026`. */
  readonly start: string;
}

/** `lstart` is the last 5 tokens; the four numbers come first. */
export function parsePsLine(line: string): ProcRow | undefined {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 9) return undefined;
  const [pid, ppid, pgid, rssKb] = tokens.slice(0, 4).map(Number) as [number, number, number, number];
  if ([pid, ppid, pgid, rssKb].some((value) => !Number.isFinite(value))) return undefined;
  return { pid, ppid, pgid, rssKb, start: tokens.slice(-5).join(" ") };
}

export const parsePsOutput = (output: string): ProcRow[] =>
  output
    .split("\n")
    .map(parsePsLine)
    .filter((row): row is ProcRow => row !== undefined);

export type Sweep = () => Promise<ProcRow[]>;

export function createPsSweep(exec: Exec = execCommand): Sweep {
  return async () => {
    const result = await exec("ps", ["-axo", "pid=,ppid=,pgid=,rss=,lstart="], {
      env: { ...process.env, LC_ALL: "C" },
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    return parsePsOutput(result.stdout);
  };
}

/** Descendants of the root by ppid, the root's process group, and every sticky pid that still has its start time. */
export function membersOf(
  rows: readonly ProcRow[],
  rootPid: number,
  sticky: ReadonlyMap<number, string>,
): ProcRow[] {
  const byParent = new Map<number, ProcRow[]>();
  for (const row of rows) byParent.set(row.ppid, [...(byParent.get(row.ppid) ?? []), row]);
  const chosen = new Map<number, ProcRow>();
  const visit = (pid: number) => {
    for (const child of byParent.get(pid) ?? []) {
      if (chosen.has(child.pid)) continue;
      chosen.set(child.pid, child);
      visit(child.pid);
    }
  };
  for (const row of rows) {
    if (row.pid === rootPid || row.pgid === rootPid) chosen.set(row.pid, row);
    if (sticky.get(row.pid) === row.start) chosen.set(row.pid, row);
  }
  for (const pid of [...chosen.keys()]) visit(pid);
  return [...chosen.values()];
}
