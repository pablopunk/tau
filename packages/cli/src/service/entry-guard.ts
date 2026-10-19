export type TemporaryRunner = "npx" | "pnpm" | "bun";

const TEMPORARY_RUNNER_FOLDERS: ReadonlyArray<readonly [TemporaryRunner, RegExp]> = [
  ["npx", /[\\/]_npx[\\/]/],
  ["pnpm", /[\\/]dlx-[^\\/]+[\\/]/],
  ["pnpm", /[\\/]pnpm[\\/]dlx[\\/]/],
  ["bun", /[\\/]\.bun[\\/]install[\\/]cache[\\/]/],
];

/** Which temporary runner (npx, pnpm dlx, bunx) cache holds this entry, if any. */
export const temporaryRunnerOf = (entry: string): TemporaryRunner | undefined =>
  TEMPORARY_RUNNER_FOLDERS.find(([, folder]) => folder.test(entry))?.[0];

export class TemporaryEntryError extends Error {
  constructor(entry: string) {
    super(`tau runs from a temporary cache (${entry}). Install tau globally first: npm i -g @pablopunk/tau.`);
    this.name = "TemporaryEntryError";
  }
}

export function refuseTemporaryEntry(entry: string): void {
  if (temporaryRunnerOf(entry) !== undefined) throw new TemporaryEntryError(entry);
}
