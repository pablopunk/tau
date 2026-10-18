import type { FileSuggestion } from "@tau/protocol";
import { listProjectPaths } from "./list-project-paths";
import { rankPaths } from "./rank-paths";

export const MAX_FILE_SUGGESTIONS = 20;

const leavesFolder = (query: string) =>
  query.includes("..") || query.startsWith("/") || query.startsWith("~");

export async function suggestFiles(folder: string, query: string): Promise<FileSuggestion[]> {
  if (leavesFolder(query)) return [];
  const entries = await listProjectPaths(folder);
  return rankPaths(entries, query.trim(), MAX_FILE_SUGGESTIONS);
}
