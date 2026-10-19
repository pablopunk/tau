import { Type } from "typebox";

/** How this tau can update itself: `run` (the button runs it), `manual` (show `command`), `none` (no button). */
export const UpdateInstallSchema = Type.Object({
  mode: Type.Union([Type.Literal("run"), Type.Literal("manual"), Type.Literal("none")]),
  command: Type.Union([Type.String(), Type.Null()]),
  reason: Type.Union([Type.String(), Type.Null()]),
});
export type UpdateInstall = Type.Static<typeof UpdateInstallSchema>;

/** The detached updater's progress. The job file's `from` is internal and never part of this type. */
export const UpdateJobSchema = Type.Object({
  state: Type.Union([
    Type.Literal("idle"),
    Type.Literal("installing"),
    Type.Literal("restarting"),
    Type.Literal("failed"),
  ]),
  target: Type.Union([Type.String(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
  logTail: Type.Union([Type.String(), Type.Null()]),
});
export type UpdateJob = Type.Static<typeof UpdateJobSchema>;

/** This tau's version against the latest published one. `latest` and `checkedAt` are null until a check succeeds. */
export const UpdateStatusSchema = Type.Object({
  current: Type.String(),
  latest: Type.Union([Type.String(), Type.Null()]),
  checkedAt: Type.Union([Type.Number(), Type.Null()]),
  behind: Type.Boolean(),
  /** True only for the owner. The server sets it per caller; core reports the owner's view. */
  canUpdate: Type.Boolean(),
  install: UpdateInstallSchema,
  job: UpdateJobSchema,
});
export type UpdateStatus = Type.Static<typeof UpdateStatusSchema>;

/** `target` is the version the dialog showed; `force` stops running work. */
export const UpdateStartBodySchema = Type.Object(
  { target: Type.String(), force: Type.Boolean() },
  { additionalProperties: false },
);
export type UpdateStartBody = Type.Static<typeof UpdateStartBodySchema>;

export const IDLE_JOB: UpdateJob = { state: "idle", target: null, error: null, logTail: null };
export const NO_INSTALL: UpdateInstall = { mode: "none", command: null, reason: null };

/** What core needs from the CLI to update (core cannot run npm). `plan` is synchronous and reads cached facts only. */
export interface UpdaterPort {
  plan(target: string): UpdateInstall;
  /** Writes the `installing` job file and starts the detached updater; the result is read back through `readJob`. */
  spawn(request: { readonly target: string }): Promise<void>;
  readJob(): Promise<UpdateJob>;
}
