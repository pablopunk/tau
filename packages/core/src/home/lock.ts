import { rm, writeFile } from "node:fs/promises";
import { PRIVATE_FILE_MODE, readFileIfPresent, writeFileAtomic } from "./atomic-write";

export interface LockInfo {
  readonly pid: number;
  /** Set by the process that owns the lock once its server listens. */
  readonly url?: string;
}

/** Another live process already uses this data home. */
export class HomeLockedError extends Error {
  readonly info: LockInfo;

  constructor(info: LockInfo) {
    super(`Another tau (pid ${info.pid}) is using this data home${info.url ? `: ${info.url}` : ""}`);
    this.name = "HomeLockedError";
    this.info = info;
  }
}

export interface HomeLock {
  publishUrl(url: string): Promise<void>;
  release(): Promise<void>;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseLockInfo(text: string | undefined): LockInfo | undefined {
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text) as Partial<LockInfo>;
    if (typeof value.pid !== "number") return undefined;
    return { pid: value.pid, url: typeof value.url === "string" ? value.url : undefined };
  } catch {
    return undefined;
  }
}

/** The owner of a live lock, or undefined when there is no lock or its owner is gone. */
export async function readLiveLockInfo(lockFile: string): Promise<LockInfo | undefined> {
  const info = parseLockInfo(await readFileIfPresent(lockFile));
  return info && isProcessAlive(info.pid) ? info : undefined;
}

async function tryCreateLock(lockFile: string): Promise<boolean> {
  try {
    await writeFile(lockFile, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: PRIVATE_FILE_MODE });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function lockHandle(lockFile: string): HomeLock {
  return {
    publishUrl: (url) => writeFileAtomic(lockFile, JSON.stringify({ pid: process.pid, url })),
    release: () => rm(lockFile, { force: true }),
  };
}

/** One process per data home. A lock left by a dead process is taken over. */
export async function acquireHomeLock(lockFile: string): Promise<HomeLock> {
  if (await tryCreateLock(lockFile)) return lockHandle(lockFile);
  const owner = await readLiveLockInfo(lockFile);
  if (owner) throw new HomeLockedError(owner);
  await rm(lockFile, { force: true });
  if (await tryCreateLock(lockFile)) return lockHandle(lockFile);
  const racedOwner = await readLiveLockInfo(lockFile);
  throw new HomeLockedError(racedOwner ?? { pid: -1 });
}
