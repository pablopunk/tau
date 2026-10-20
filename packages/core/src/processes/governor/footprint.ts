import { type Exec, execCommand } from "./exec";

/** Total `phys_footprint` of the pids in KB, or `undefined` when it cannot be read. */
export type Footprint = (pids: readonly number[]) => Promise<number | undefined>;

const PER_PROCESS = /\]: [^\n]*Footprint: (\d+) B/g;

const SUMMARY = /Summary Footprint: (\d+) B/;

/** The summary line counts memory shared between the pids once; a single pid has no summary. */
export function parseFootprintOutput(output: string): number | undefined {
  const summary = SUMMARY.exec(output)?.[1];
  if (summary !== undefined) return Math.round(Number(summary) / 1024);
  const sizes = [...output.matchAll(PER_PROCESS)].map((match) => Number(match[1]));
  if (sizes.length === 0) return undefined;
  return Math.round(sizes.reduce((sum, size) => sum + size, 0) / 1024);
}

/**
 * macOS `footprint`: one call for every pid (~125 ms for 30). RSS counts shared libraries once per process
 * (an idle node is 37 MB RSS and 11 MB footprint), so a tree of many processes looks bigger than it is.
 */
export function createFootprint(exec: Exec = execCommand): Footprint {
  return async (pids) => {
    if (pids.length === 0) return undefined;
    const args = [...pids.flatMap((pid) => ["-p", String(pid)]), "--noCategories", "-f", "bytes"];
    const result = await exec("/usr/bin/footprint", args, {
      env: { ...process.env, LC_ALL: "C" },
      timeoutMs: 5000,
    });
    return parseFootprintOutput(result.stdout);
  };
}
