import { existsSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";

export const versionsDirOf = (root: string) => join(root, "versions");
export const versionDirIn = (root: string, version: string) => join(versionsDirOf(root), version);
const currentLinkOf = (root: string) => join(root, "current");

/** The version `current` points at, or undefined (no link, or not a link into `versions/`). */
export function currentVersionOf(root: string): string | undefined {
  try {
    const target = basename(readlinkSync(currentLinkOf(root)));
    return existsSync(versionDirIn(root, target)) ? target : undefined;
  } catch {
    return undefined;
  }
}

/** Atomic: a new symlink next to `current`, then `rename()` over it. A running binary keeps its old inode. */
export function swapCurrent(root: string, version: string): void {
  const temp = join(root, `current.tmp-${process.pid}`);
  rmSync(temp, { force: true });
  symlinkSync(join("versions", version), temp);
  renameSync(temp, currentLinkOf(root));
}

/** `<home>/server.json`: who serves this home and from which folder. Retention must not delete that folder. */
export interface ServerRecord {
  readonly pid: number;
  readonly versionDir: string;
}

export const serverRecordOf = (home: string) => join(home, "server.json");

export function readServerRecord(home: string): ServerRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(serverRecordOf(home), "utf8")) as Partial<ServerRecord>;
    return typeof value.pid === "number" && typeof value.versionDir === "string"
      ? { pid: value.pid, versionDir: value.versionDir }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * After a good update keep the new `current`, the folder that was `current` before, and the folder the running
 * server started from. Everything else in `versions/` goes. Returns the removed names.
 */
export function pruneVersions(root: string, keep: readonly (string | undefined)[], home: string): string[] {
  const running = readServerRecord(home);
  const spared = new Set([...keep, running ? basename(running.versionDir) : undefined]);
  const removed: string[] = [];
  for (const name of readdirSync(versionsDirOf(root))) {
    if (spared.has(name)) continue;
    rmSync(versionDirIn(root, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}
