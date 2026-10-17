import type { FileSuggestion } from "@pi-everywhere/protocol";

export const MAX_FILE_SUGGESTIONS = 20;

/** Frozen shape; Phase 1 (B) answers from `git ls-files` or a bounded walk of `folder`. */
export async function suggestFiles(_folder: string, _query: string): Promise<FileSuggestion[]> {
  return [];
}
