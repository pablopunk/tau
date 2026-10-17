import { readdir } from "node:fs/promises";
import type { FileSuggestion } from "@pi-everywhere/protocol";

export const WALK_MAX_DEPTH = 4;
export const WALK_MAX_ENTRIES = 5000;

const skipped = (name: string) => name.startsWith(".") || name === "node_modules";

export async function walkFolder(root: string): Promise<FileSuggestion[]> {
  const found: FileSuggestion[] = [];
  let level: string[] = [""];
  for (let depth = 0; depth < WALK_MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const relative of level) {
      const children = await readdir(`${root}/${relative}`, { withFileTypes: true }).catch(() => []);
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        if (skipped(child.name) || child.isSymbolicLink()) continue;
        if (found.length >= WALK_MAX_ENTRIES) return found;
        const path = relative === "" ? child.name : `${relative}/${child.name}`;
        if (child.isDirectory()) {
          found.push({ path, kind: "directory" });
          next.push(path);
        } else if (child.isFile()) {
          found.push({ path, kind: "file" });
        }
      }
    }
    level = next;
  }
  return found;
}
