export function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

export function groupIsAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function terminateGroup(pid: number, graceMs: number): Promise<void> {
  if (!signalGroup(pid, "SIGTERM")) return;
  const deadline = Date.now() + graceMs;
  while (groupIsAlive(pid) && Date.now() < deadline) await sleep(50);
  signalGroup(pid, "SIGKILL");
}
