export function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

export function groupIsAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const VERIFY_MS = 1000;

export async function terminateGroup(
  pid: number,
  graceMs: number,
  onSurviving?: (pid: number) => void,
): Promise<void> {
  // A spawn that never started reports pid 0; `kill(-0)` would address our own
  // group. Stopping nothing is idempotent, so resolve silently.
  if (pid <= 0) return;
  if (!signalGroup(pid, "SIGTERM")) return;
  const deadline = Date.now() + graceMs;
  while (groupIsAlive(pid) && Date.now() < deadline) await sleep(50);
  signalGroup(pid, "SIGKILL");
  // Bounded verify poll: annotate escapees, never block the stop path on them.
  const verifyUntil = Date.now() + VERIFY_MS;
  while (groupIsAlive(pid) && Date.now() < verifyUntil) await sleep(50);
  if (groupIsAlive(pid)) onSurviving?.(pid);
}
