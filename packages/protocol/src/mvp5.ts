import { Type } from "typebox";

export const WorkspaceStatusSchema = Type.Object({
  ahead: Type.Number(),
  behind: Type.Number(),
  dirtyFiles: Type.Array(Type.String()),
  unmergedCommits: Type.Number(),
  canMerge: Type.Boolean(),
  reason: Type.Union([Type.String(), Type.Null()]),
});
export type WorkspaceStatus = Type.Static<typeof WorkspaceStatusSchema>;

export const CheckpointFileSchema = Type.Object({
  path: Type.String(),
  added: Type.Number(),
  removed: Type.Number(),
  status: Type.Union([Type.Literal("A"), Type.Literal("M"), Type.Literal("D"), Type.Literal("R")]),
});
export type CheckpointFile = Type.Static<typeof CheckpointFileSchema>;

export const CheckpointSchema = Type.Object({
  id: Type.String(),
  requestId: Type.String(),
  entryId: Type.Union([Type.String(), Type.Null()]),
  kind: Type.Union([Type.Literal("before"), Type.Literal("after")]),
  at: Type.Number(),
  files: Type.Array(CheckpointFileSchema),
});
export type Checkpoint = Type.Static<typeof CheckpointSchema>;

export const RestorePreviewSchema = Type.Object({
  checkpointId: Type.String(),
  changes: Type.Array(
    Type.Object({ path: Type.String(), action: Type.Union([Type.Literal("write"), Type.Literal("delete")]) }),
  ),
});
export type RestorePreview = Type.Static<typeof RestorePreviewSchema>;

export const ProcessInfoSchema = Type.Object({
  id: Type.String(),
  conversationId: Type.String(),
  name: Type.String(),
  command: Type.String(),
  state: Type.Union([
    Type.Literal("queued"),
    Type.Literal("running"),
    Type.Literal("exited"),
    Type.Literal("killed"),
  ]),
  exitCode: Type.Union([Type.Number(), Type.Null()]),
  startedAt: Type.Number(),
  urls: Type.Array(Type.String()),
  kind: Type.Union([Type.Literal("process"), Type.Literal("monitor")]),
});
export type ProcessInfo = Type.Static<typeof ProcessInfoSchema>;

const StringRecord = Type.Record(Type.String(), Type.String());

export const McpServerConfigSchema = Type.Union([
  Type.Object({
    name: Type.String({ minLength: 1 }),
    command: Type.String({ minLength: 1 }),
    args: Type.Array(Type.String()),
    env: StringRecord,
  }),
  Type.Object({
    name: Type.String({ minLength: 1 }),
    url: Type.String({ minLength: 1 }),
    headers: StringRecord,
  }),
]);
export type McpServerConfig = Type.Static<typeof McpServerConfigSchema>;

export const McpServerStatusSchema = Type.Object({
  name: Type.String(),
  source: Type.Union([Type.Literal("settings"), Type.Literal("project")]),
  transport: Type.Union([Type.Literal("stdio"), Type.Literal("http")]),
  state: Type.Union([Type.Literal("idle"), Type.Literal("connected"), Type.Literal("error")]),
  toolCount: Type.Union([Type.Number(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
});
export type McpServerStatus = Type.Static<typeof McpServerStatusSchema>;
