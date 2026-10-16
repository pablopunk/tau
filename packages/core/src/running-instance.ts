import { join } from "node:path";
import { writeFileAtomic } from "./home/atomic-write";
import { type LockInfo, readLiveLockInfo } from "./home/lock";

const lockFileOf = (home: string) => join(home, "lock");

/** For a second launch: who runs on this home, and at which URL (if it published one). */
export function readRunningInstance(home: string): Promise<LockInfo | undefined> {
  return readLiveLockInfo(lockFileOf(home));
}

/** The process that created the core records where its server listens. */
export function publishServerUrl(home: string, url: string): Promise<void> {
  return writeFileAtomic(lockFileOf(home), JSON.stringify({ pid: process.pid, url }));
}
