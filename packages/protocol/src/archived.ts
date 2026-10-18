import { Type } from "typebox";

export const DeleteArchivedInputSchema = Type.Object({ force: Type.Boolean() });
export type DeleteArchivedInput = Type.Static<typeof DeleteArchivedInputSchema>;

export const DeleteArchivedResultSchema = Type.Object({
  deleted: Type.Array(Type.String()),
  kept: Type.Array(Type.Object({ id: Type.String(), reason: Type.String() })),
});
export type DeleteArchivedResult = Type.Static<typeof DeleteArchivedResultSchema>;

export interface UnmergedKinds {
  readonly uncommitted: boolean;
  readonly commits: boolean;
}

const UNMERGED_COMMITS_LINE = /unmerged commit/;

export const unmergedKindsOf = (lines: readonly string[]): UnmergedKinds => ({
  commits: lines.some((line) => UNMERGED_COMMITS_LINE.test(line)),
  uncommitted: lines.some((line) => !UNMERGED_COMMITS_LINE.test(line)),
});

const describeKinds = ({ uncommitted, commits }: UnmergedKinds) =>
  uncommitted && commits
    ? "Uncommitted changes and unmerged commits"
    : uncommitted
      ? "Uncommitted changes"
      : "Unmerged commits";

export const unmergedWarningFor = (branch: string | null, kinds: UnmergedKinds) =>
  `${describeKinds(kinds)} in ${branch ?? "this worktree"}`;

export const unmergedBadgeLabel = (warning: string) =>
  warning.startsWith("Uncommitted changes and")
    ? "Uncommitted + unmerged"
    : warning.startsWith("Uncommitted changes")
      ? "Uncommitted changes"
      : warning.startsWith("Unmerged commits")
        ? "Unmerged commits"
        : "Unmerged work";
