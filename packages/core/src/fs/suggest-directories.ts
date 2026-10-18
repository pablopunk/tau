import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { PathSuggestion, SuggestDirectoriesInput } from "@tau/protocol";
import { collapseHome, expandHome } from "./expand-home";

const DEFAULT_LIMIT = 50;
const REPO_MARKER = ".git";

const isDirectory = (path: string) =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function isDirectoryEntry(parent: string, entry: Dirent): Promise<boolean> {
  if (entry.isDirectory()) return true;
  return entry.isSymbolicLink() && (await isDirectory(join(parent, entry.name)));
}

function toAbsolute(prefix: string): string {
  if (prefix === "~") return `${homedir()}/`;
  const expanded = expandHome(prefix);
  return expanded.startsWith("/") ? expanded : `${homedir()}/${expanded}`;
}

export function splitPrefix(prefix: string): { parent: string; partial: string } {
  const absolute = toAbsolute(prefix);
  const slash = absolute.lastIndexOf("/");
  return { parent: resolve(absolute.slice(0, slash + 1)), partial: absolute.slice(slash + 1) };
}

const matchesPartial = (name: string, partial: string) =>
  name.toLowerCase().startsWith(partial.toLowerCase()) && (!name.startsWith(".") || partial.startsWith("."));

const exactFirstThenAlphabetical = (partial: string) => (a: string, b: string) => {
  const exact = (name: string) => (name.toLowerCase() === partial.toLowerCase() ? 0 : 1);
  return exact(a) - exact(b) || a.localeCompare(b);
};

async function toSuggestion(parent: string, name: string): Promise<PathSuggestion> {
  const path = join(parent, name);
  return { path, display: collapseHome(path), isGitRepo: await exists(join(path, REPO_MARKER)) };
}

async function folderNamesMatching(parent: string, partial: string): Promise<string[]> {
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  const named = entries.filter((entry) => matchesPartial(entry.name, partial));
  const kept = await Promise.all(
    named.map(async (entry) => ((await isDirectoryEntry(parent, entry)) ? entry.name : null)),
  );
  return kept.filter((name): name is string => name !== null);
}

/** Folders whose name starts with the last segment of `prefix`; never throws. */
export async function suggestDirectories(input: SuggestDirectoriesInput): Promise<PathSuggestion[]> {
  const { parent, partial } = splitPrefix(input.prefix);
  const names = (await folderNamesMatching(parent, partial)).sort(exactFirstThenAlphabetical(partial));
  return Promise.all(names.slice(0, input.limit ?? DEFAULT_LIMIT).map((name) => toSuggestion(parent, name)));
}
