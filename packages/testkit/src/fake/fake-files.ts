import type { FileSuggestion } from "@tau/protocol";
import type { FakeFs } from "./fake-fs";

const MAX_SUGGESTIONS = 20;

const basenameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function isUnsafeQuery(query: string): boolean {
  return query.includes("..") || query.startsWith("/") || query.startsWith("~");
}

function directoriesOf(files: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.split("/").slice(0, -1);
    for (let length = 1; length <= parts.length; length++) directories.add(parts.slice(0, length).join("/"));
  }
  return [...directories];
}

function rank(path: string, query: string): number {
  const name = basenameOf(path).toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  return path.toLowerCase().includes(query) ? 2 : 3;
}

export function suggestFakeFiles(fs: FakeFs, projectPath: string, rawQuery: string): FileSuggestion[] {
  if (isUnsafeQuery(rawQuery)) return [];
  const query = rawQuery.trim().toLowerCase();
  const root = `${projectPath}/`;
  const files = Object.entries(fs)
    .filter(([path, kind]) => kind === "file" && path.startsWith(root))
    .map(([path]) => path.slice(root.length));
  const all: FileSuggestion[] = [
    ...directoriesOf(files).map((path) => ({ path, kind: "directory" as const })),
    ...files.map((path) => ({ path, kind: "file" as const })),
  ];
  return all
    .map((suggestion) => ({ suggestion, rank: rank(suggestion.path, query) }))
    .filter(({ rank: value }) => value < 3)
    .sort((a, b) => a.rank - b.rank || a.suggestion.path.localeCompare(b.suggestion.path))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ suggestion }) => suggestion);
}
