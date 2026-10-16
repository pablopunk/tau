import { type Dirent, lstatSync } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { repositoryKey } from "../git/repository-key";
import { readRemoteUrls } from "./remotes";

export const SCAN_ENTRY_LIMIT = 2000;
const SCAN_DEPTH = 2;
const REMOTE_READS_AT_ONCE = 8;

/** Repository key to the paths of its local copies. */
export type LocalCopies = ReadonlyMap<string, readonly string[]>;

export interface LocalScan {
  readonly root: string;
  readonly copies: LocalCopies;
}

export type ReadRemotes = (directory: string) => Promise<string[]>;

const isScannable = (entry: Dirent) =>
  entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules";

const hasGitEntry = (directory: string) => {
  try {
    lstatSync(join(directory, ".git"));
    return true;
  } catch {
    return false;
  }
};

const listDirectories = (directory: string) =>
  readdir(directory, { withFileTypes: true }).catch(() => [] as Dirent[]);

async function findRepositories(root: string): Promise<string[]> {
  const repositories: string[] = [];
  let seen = 0;
  const visit = async (directory: string, depth: number): Promise<void> => {
    for (const entry of await listDirectories(directory)) {
      if (++seen > SCAN_ENTRY_LIMIT) return;
      if (!isScannable(entry)) continue;
      const path = join(directory, entry.name);
      if (hasGitEntry(path)) repositories.push(path);
      else if (depth < SCAN_DEPTH) await visit(path, depth + 1);
      if (seen > SCAN_ENTRY_LIMIT) return;
    }
  };
  await visit(root, 1);
  return repositories;
}

async function mapWithLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const realpathOrUndefined = (path: string) => realpath(path).catch(() => undefined);

export const refusesToScan = (root: string, home: string | undefined) => root === "/" || root === home;

export async function scanLocalRepos(
  codeFolder: string,
  homeDirectory: string,
  readRemotes: ReadRemotes = readRemoteUrls,
): Promise<LocalScan> {
  const root = await realpathOrUndefined(codeFolder);
  if (root === undefined || refusesToScan(root, await realpathOrUndefined(homeDirectory))) {
    return { root: codeFolder, copies: new Map() };
  }
  const repositories = await findRepositories(root);
  const remotes = await mapWithLimit(repositories, REMOTE_READS_AT_ONCE, readRemotes);
  const copies = new Map<string, string[]>();
  repositories.forEach((path, index) => {
    for (const key of new Set((remotes[index] ?? []).map(repositoryKey))) {
      copies.set(key, [...(copies.get(key) ?? []), path]);
    }
  });
  return { root, copies };
}

/** The copy at `<codeFolder>/<repo>` first, then the shortest path. */
export function pickLocalCopy(
  paths: readonly string[],
  codeFolder: string,
  repoName: string,
): string | undefined {
  const exact = join(codeFolder, repoName);
  return (
    paths.find((path) => path === exact) ??
    [...paths].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
  );
}
