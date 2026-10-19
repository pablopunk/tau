import type { RunCommand } from "./command-runner";

const MAX_DEPTH = 64;

/** Best effort (POSIX): the pids above this process, from `ps -o ppid= -p`. */
export async function ancestorPidsOf(run: RunCommand, start: number = process.pid): Promise<number[]> {
  const pids: number[] = [];
  let current = start;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const result = await run("ps", ["-o", "ppid=", "-p", String(current)], {
      stdio: "capture",
      timeoutMs: 5000,
    });
    const parent = Number(result.stdout.trim());
    if (result.code !== 0 || !Number.isInteger(parent) || parent <= 1 || pids.includes(parent)) break;
    pids.push(parent);
    current = parent;
  }
  return pids;
}
