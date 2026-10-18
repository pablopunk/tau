import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FileSuggestion } from "@tau/protocol";
import { walkFolder } from "./walk-folder";

export const FILE_LIST_CACHE_MS = 10_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

const run = promisify(execFile);

function withDirectories(files: string[]): FileSuggestion[] {
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.split("/").slice(0, -1);
    for (let end = 1; end <= parts.length; end++) directories.add(parts.slice(0, end).join("/"));
  }
  return [
    ...[...directories].map((path): FileSuggestion => ({ path, kind: "directory" })),
    ...files.map((path): FileSuggestion => ({ path, kind: "file" })),
  ];
}

async function gitFiles(folder: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await run("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      cwd: folder,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout.split("\0").filter((path) => path !== "");
  } catch {
    return undefined;
  }
}

async function listUncached(folder: string): Promise<FileSuggestion[]> {
  const files = await gitFiles(folder);
  return files === undefined ? walkFolder(folder) : withDirectories(files);
}

const cache = new Map<string, { at: number; entries: Promise<FileSuggestion[]> }>();

export function listProjectPaths(folder: string): Promise<FileSuggestion[]> {
  const hit = cache.get(folder);
  if (hit && Date.now() - hit.at < FILE_LIST_CACHE_MS) return hit.entries;
  const entries = listUncached(folder);
  cache.set(folder, { at: Date.now(), entries });
  return entries;
}

export function clearFileListCache(): void {
  cache.clear();
}
