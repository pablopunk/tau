import { Type } from "typebox";

/** This tau's version against the latest published one. `latest` and `checkedAt` are null until a check succeeds. */
export const UpdateStatusSchema = Type.Object({
  current: Type.String(),
  latest: Type.Union([Type.String(), Type.Null()]),
  checkedAt: Type.Union([Type.Number(), Type.Null()]),
  behind: Type.Boolean(),
});
export type UpdateStatus = Type.Static<typeof UpdateStatusSchema>;
