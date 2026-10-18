import type { LockInfo } from "@tau/core";
import { readRunningInstance } from "@tau/core";

export const LOCK_POLL_MS = 5000;

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface WaitForLockDependencies {
  readonly readInstance?: (home: string) => Promise<LockInfo | undefined>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (message: string) => void;
  readonly intervalMs?: number;
}

/** `serve --service` waits here while a foreground tau holds the home, so no manager sees an exit loop. */
export async function waitForFreeHome(
  home: string,
  dependencies: WaitForLockDependencies = {},
): Promise<void> {
  const {
    readInstance = readRunningInstance,
    sleep = sleepFor,
    log,
    intervalMs = LOCK_POLL_MS,
  } = dependencies;
  let announced = false;
  for (let owner = await readInstance(home); owner; owner = await readInstance(home)) {
    if (!announced) log?.(`Another tau (pid ${owner.pid}) holds ${home}. Waiting for it to stop.`);
    announced = true;
    await sleep(intervalMs);
  }
}

/** Polls until the running server has published its URL. */
export async function waitForUrl(
  home: string,
  dependencies: WaitForLockDependencies & { readonly attempts?: number } = {},
): Promise<LockInfo | undefined> {
  const {
    readInstance = readRunningInstance,
    sleep = sleepFor,
    intervalMs = 250,
    attempts = 60,
  } = dependencies;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const info = await readInstance(home);
    if (info?.url) return info;
    await sleep(intervalMs);
  }
  return undefined;
}
