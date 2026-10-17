import type { FileSuggestion } from "@pi-everywhere/protocol";

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const NO_MATCH = 3;

function tier(path: string, query: string): number {
  const name = basename(path).toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  return path.toLowerCase().includes(query) ? 2 : NO_MATCH;
}

export function rankPaths(entries: FileSuggestion[], rawQuery: string, limit: number): FileSuggestion[] {
  const query = rawQuery.toLowerCase();
  return entries
    .map((entry) => ({ entry, tier: query === "" ? 0 : tier(entry.path, query) }))
    .filter((ranked) => ranked.tier < NO_MATCH)
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.entry.path.length - b.entry.path.length ||
        a.entry.path.localeCompare(b.entry.path),
    )
    .slice(0, limit)
    .map((ranked) => ranked.entry);
}
