import { Type } from "typebox";

export const DeleteArchivedInputSchema = Type.Object({ force: Type.Boolean() });
export type DeleteArchivedInput = Type.Static<typeof DeleteArchivedInputSchema>;

export const DeleteArchivedResultSchema = Type.Object({
  deleted: Type.Array(Type.String()),
  kept: Type.Array(Type.Object({ id: Type.String(), reason: Type.String() })),
});
export type DeleteArchivedResult = Type.Static<typeof DeleteArchivedResultSchema>;

export const unmergedWarningFor = (branch: string | null) =>
  `Unmerged work in ${branch ?? "this worktree"}, not cleaned up`;
