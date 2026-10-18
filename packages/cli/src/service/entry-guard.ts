const TEMPORARY_RUNNER_FOLDERS = [
  /[\\/]_npx[\\/]/,
  /[\\/]dlx-[^\\/]+[\\/]/,
  /[\\/]pnpm[\\/]dlx[\\/]/,
  /[\\/]\.bun[\\/]install[\\/]cache[\\/]/,
];

export const isTemporaryRunnerEntry = (entry: string): boolean =>
  TEMPORARY_RUNNER_FOLDERS.some((folder) => folder.test(entry));

export class TemporaryEntryError extends Error {
  constructor(entry: string) {
    super(`tau runs from a temporary cache (${entry}). Install tau globally first.`);
    this.name = "TemporaryEntryError";
  }
}

export function refuseTemporaryEntry(entry: string): void {
  if (isTemporaryRunnerEntry(entry)) throw new TemporaryEntryError(entry);
}
