import { type TSchema, Type } from "typebox";
import {
  DeviceSchema,
  MintedPairingSchema,
  MintPairingInputSchema,
  RedeemPairingBodySchema,
  RedeemPairingResponseSchema,
  RenameDeviceBodySchema,
  RotateAccessBodySchema,
  RotateAccessResultSchema,
} from "./access";
import { DeleteArchivedInputSchema, DeleteArchivedResultSchema } from "./archived";
import {
  AbortResultSchema,
  CancelQueuedResultSchema,
  ClaudeConnectorSettingsSchema,
  CompactInputSchema,
  CompactionSettingsSchema,
  ConfigureConversationInputSchema,
  ConversationSummarySchema,
  FileRefSchema,
  FileSuggestionSchema,
  GithubRepoSchema,
  GithubStatusSchema,
  IconCandidateLinkSchema,
  LoginSessionSchema,
  MessageModeSchema,
  ModelInfoSchema,
  ModelRefSchema,
  PathSuggestionSchema,
  ProjectSchema,
  ProviderIdSchema,
  ProviderInfoSchema,
  RetryInputSchema,
  SendMessageInputSchema,
  SendNowInputSchema,
  SendNowResultSchema,
  SendReceiptSchema,
  SetQueuedModeResultSchema,
  SettingsSchema,
  SkillSchema,
  StartConversationInputSchema,
  SuggestDirectoriesInputSchema,
  SuggestedCodeFolderSchema,
  ThinkingLevelSchema,
  TranscribeInputSchema,
  UploadInputSchema,
  UseGithubRepoInputSchema,
  VoiceModelSettingSchema,
  VoiceOptionsSchema,
  WhenBusySchema,
  WorkspaceDefaultSchema,
} from "./entities";
import { HandoffInputSchema, HandoffPreviewSchema } from "./handoff";
import { ICON_BODY_LIMIT } from "./icons";
import { MetricsResponseSchema } from "./metrics";
import {
  CheckpointSchema,
  McpServerConfigSchema,
  McpServerStatusSchema,
  ProcessInfoSchema,
  RestorePreviewSchema,
  WorkspaceStatusSchema,
} from "./mvp5";
import { GoalInputSchema, GoalSchema, LoopInputSchema, TimerSchema } from "./mvp8";
import { ApprovalDecisionSchema, ApprovalSchema } from "./mvp10";
import { DirectoryNodeSchema, ExpulsionSchema, RemoveNodeBodySchema } from "./node-group";
import { NodeSchema, NodeSelfSchema, NodeSummarySchema, RenameNodeBodySchema } from "./nodes";
import { HealthSchema, RemoteStatusSchema } from "./remote";
import { ResourceActivitySchema, ResourceSettingsSchema, ResourceSupportSchema } from "./resources";
import { RuntimeDescriptorListSchema } from "./runtime";
import { SandboxSettingsSchema } from "./sandbox";
import { OpenTerminalInputSchema, TerminalAvailabilitySchema, TerminalInfoSchema } from "./terminals";
import { UpdateTodosInputSchema } from "./todos";
import { UpdateStartBodySchema, UpdateStatusSchema } from "./updates";

export const API_PREFIX = "/api";
export const LIVE_PATH = `${API_PREFIX}/live`;
export const PAIR_PAGE_PATH = "/pair";

export const MESSAGE_BODY_LIMIT = 42 * 1024 * 1024;
/** Audio uploads copy the image pattern: base64-in-JSON, parsed in memory only, transcribed and discarded. */
export const AUDIO_BODY_LIMIT = 10 * 1024 * 1024;
/** Caps `POST /api/uploads`: base64 inflates 5 MiB of file bytes to about 6.7 MiB on the wire. */
export const UPLOAD_BODY_LIMIT = 8 * 1024 * 1024;
export const PROCESS_LOG_TAIL_DEFAULT = 200;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteDef {
  readonly method: HttpMethod;
  readonly path: string;
  readonly status: 200 | 201 | 202 | 204;
  readonly params?: TSchema;
  readonly query?: TSchema;
  /** `image` routes answer raw bytes (cookie-authenticated GET, used as `<img src>`); the default is JSON. */
  readonly responseKind?: "json" | "image";
  readonly body?: TSchema;
  readonly response?: TSchema;
  readonly bodyLimit?: number;
  /** Only the owner may call this (server enforces `route.ownerOnly || options.ownerOnly` with `forbidden`). */
  readonly ownerOnly?: boolean;
}

const IdParams = Type.Object({ id: Type.String({ minLength: 1 }) });
const ProviderParams = Type.Object({ id: ProviderIdSchema });
const SessionParams = Type.Object({ sid: Type.String({ minLength: 1 }) });
const QueueItemParams = Type.Object({
  id: Type.String({ minLength: 1 }),
  itemId: Type.String({ minLength: 1 }),
});
const CheckpointParams = Type.Object({
  id: Type.String({ minLength: 1 }),
  cid: Type.String({ minLength: 1 }),
});
const ApprovalParams = Type.Object({
  id: Type.String({ minLength: 1 }),
  toolUseId: Type.String({ minLength: 1 }),
});
const ToolCallParams = Type.Object({
  id: Type.String({ minLength: 1 }),
  callId: Type.String({ minLength: 1 }),
});
const ForceQuery = Type.Object({
  force: Type.Optional(Type.Union([Type.Literal("true"), Type.Literal("false")])),
});
const NameParams = Type.Object({ name: Type.String({ minLength: 1 }) });
const EntryBody = Type.Object({ entryId: Type.String({ minLength: 1 }) });

export const routes = {
  getHealth: { method: "GET", path: `${API_PREFIX}/health`, status: 200, response: HealthSchema },
  getMetrics: {
    method: "GET",
    path: `${API_PREFIX}/metrics`,
    status: 200,
    ownerOnly: true,
    response: MetricsResponseSchema,
  },
  getRemoteStatus: { method: "GET", path: `${API_PREFIX}/remote`, status: 200, response: RemoteStatusSchema },
  enableRemote: {
    method: "POST",
    path: `${API_PREFIX}/remote/enable`,
    status: 200,
    response: RemoteStatusSchema,
  },
  disableRemote: {
    method: "POST",
    path: `${API_PREFIX}/remote/disable`,
    status: 200,
    response: RemoteStatusSchema,
  },
  recreateRemote: {
    method: "POST",
    path: `${API_PREFIX}/remote/recreate`,
    status: 200,
    response: RemoteStatusSchema,
  },
  listDevices: {
    method: "GET",
    path: `${API_PREFIX}/access/devices`,
    status: 200,
    response: Type.Array(DeviceSchema),
  },
  renameDevice: {
    method: "PUT",
    path: `${API_PREFIX}/access/devices/:id`,
    status: 204,
    params: IdParams,
    body: RenameDeviceBodySchema,
  },
  revokeDevice: { method: "DELETE", path: `${API_PREFIX}/access/devices/:id`, status: 204, params: IdParams },
  signOutAllDevices: { method: "POST", path: `${API_PREFIX}/access/sign-out-all`, status: 204 },
  /** Revokes every device not in `keep` and swaps the master token live (`session.rotate`). */
  rotateAccess: {
    method: "POST",
    path: `${API_PREFIX}/access/rotate`,
    status: 200,
    body: RotateAccessBodySchema,
    response: RotateAccessResultSchema,
  },
  mintPairing: {
    method: "POST",
    path: `${API_PREFIX}/pair`,
    status: 200,
    query: MintPairingInputSchema,
    response: MintedPairingSchema,
  },
  redeemPairing: {
    method: "POST",
    path: `${API_PREFIX}/pair/redeem`,
    status: 200,
    body: RedeemPairingBodySchema,
    response: RedeemPairingResponseSchema,
  },
  listNodes: {
    method: "GET",
    path: `${API_PREFIX}/nodes`,
    status: 200,
    response: Type.Array(NodeSchema),
  },
  renameNode: {
    method: "PUT",
    path: `${API_PREFIX}/nodes/:id`,
    status: 204,
    params: IdParams,
    body: RenameNodeBodySchema,
  },
  getNodeSummary: {
    method: "GET",
    path: `${API_PREFIX}/nodes/:id/summary`,
    status: 200,
    params: IdParams,
    response: NodeSummarySchema,
  },
  disconnectNode: { method: "DELETE", path: `${API_PREFIX}/nodes/:id`, status: 204, params: IdParams },
  /** This tau itself: nodeId, name, os, versions. */
  getNodeSelf: { method: "GET", path: `${API_PREFIX}/nodes/self`, status: 200, response: NodeSelfSchema },
  /** Local only: revokes the node's device here and closes its links; no flood (Step 2 adds the group-wide `remove`). */
  forgetNode: { method: "POST", path: `${API_PREFIX}/nodes/:id/forget`, status: 204, params: IdParams },
  /** Deletes `node.json` and `peers.json`: a new key and `nodeId`, every link closed. */
  resetNodeIdentity: { method: "POST", path: `${API_PREFIX}/nodes/identity/reset`, status: 204 },
  /** The group as this node sees it: neighbours and routed nodes, with hops, `via`, skew and ghosts. */
  getNodeDirectory: {
    method: "GET",
    path: `${API_PREFIX}/nodes/directory`,
    status: 200,
    response: Type.Array(DirectoryNodeSchema),
  },
  /** Verified expels with `by`, time and who confirmed. */
  listExpulsions: {
    method: "GET",
    path: `${API_PREFIX}/nodes/expulsions`,
    status: 200,
    response: Type.Array(ExpulsionSchema),
  },
  /** Group-wide expel, created on THIS node only (never proxied: `nodes` stays on the path denylist). Typed confirmation in the body. */
  removeNode: {
    method: "POST",
    path: `${API_PREFIX}/nodes/:id/remove`,
    status: 204,
    params: IdParams,
    body: RemoveNodeBodySchema,
  },
  /** A WebSocket route: either node dials the other here with a node secret (`node-link.ts`). `/api/machines/link` is the 0.1.x alias. */
  linkNode: { method: "GET", path: `${API_PREFIX}/nodes/link`, status: 200 },
  getUpdateStatus: { method: "GET", path: `${API_PREFIX}/update`, status: 200, response: UpdateStatusSchema },
  refreshUpdateStatus: {
    method: "POST",
    path: `${API_PREFIX}/update/refresh`,
    status: 200,
    response: UpdateStatusSchema,
  },
  /** Owner only (403 `forbidden` otherwise). Returns the status with the job `installing`. */
  startUpdate: {
    method: "POST",
    path: `${API_PREFIX}/update/start`,
    status: 202,
    body: UpdateStartBodySchema,
    response: UpdateStatusSchema,
  },
  getSettings: { method: "GET", path: `${API_PREFIX}/settings`, status: 200, response: SettingsSchema },
  setDefaultModel: {
    method: "PUT",
    path: `${API_PREFIX}/settings/default-model`,
    status: 204,
    body: ModelRefSchema,
  },
  setDefaultThinking: {
    method: "PUT",
    path: `${API_PREFIX}/settings/default-thinking`,
    status: 204,
    body: Type.Object({ thinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()]) }),
  },
  setFastThinking: {
    method: "PUT",
    path: `${API_PREFIX}/settings/fast-thinking`,
    status: 204,
    body: Type.Object({ thinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()]) }),
  },
  setFastModel: {
    method: "PUT",
    path: `${API_PREFIX}/settings/fast-model`,
    status: 204,
    body: Type.Object({ model: Type.Union([ModelRefSchema, Type.Null()]) }),
  },
  setVoiceModel: {
    method: "PUT",
    path: `${API_PREFIX}/settings/voice-model`,
    status: 204,
    body: Type.Object({ setting: VoiceModelSettingSchema }),
  },
  getVoiceOptions: {
    method: "GET",
    path: `${API_PREFIX}/voice/options`,
    status: 200,
    response: VoiceOptionsSchema,
  },
  transcribeVoice: {
    method: "POST",
    path: `${API_PREFIX}/voice/transcribe`,
    status: 200,
    body: TranscribeInputSchema,
    response: Type.Object({ text: Type.String() }),
    bodyLimit: AUDIO_BODY_LIMIT,
  },
  removeVoiceModel: {
    method: "DELETE",
    path: `${API_PREFIX}/voice/model`,
    status: 204,
  },
  warmVoice: {
    method: "POST",
    path: `${API_PREFIX}/voice/warm`,
    status: 204,
  },
  setSetupSkipped: {
    method: "PUT",
    path: `${API_PREFIX}/settings/setup-skipped`,
    status: 204,
    body: Type.Object({ skipped: Type.Boolean() }),
  },
  setMessageMode: {
    method: "PUT",
    path: `${API_PREFIX}/settings/message-mode`,
    status: 204,
    body: Type.Object({ mode: MessageModeSchema }),
  },
  setWorkspaceDefault: {
    method: "PUT",
    path: `${API_PREFIX}/settings/workspace-default`,
    status: 204,
    body: Type.Object({ mode: WorkspaceDefaultSchema }),
  },
  setClaudeConnectors: {
    method: "PUT",
    path: `${API_PREFIX}/settings/claude-connectors`,
    status: 204,
    body: ClaudeConnectorSettingsSchema,
  },
  setResources: {
    method: "PUT",
    path: `${API_PREFIX}/settings/resources`,
    status: 204,
    body: ResourceSettingsSchema,
  },
  setSandbox: {
    method: "PUT",
    path: `${API_PREFIX}/settings/sandbox`,
    status: 204,
    body: SandboxSettingsSchema,
  },
  setCompaction: {
    method: "PUT",
    path: `${API_PREFIX}/settings/compaction`,
    status: 204,
    body: CompactionSettingsSchema,
  },
  getResourceSupport: {
    method: "GET",
    path: `${API_PREFIX}/settings/resources/support`,
    status: 200,
    response: ResourceSupportSchema,
  },
  getResourceActivity: {
    method: "GET",
    path: `${API_PREFIX}/settings/resources/activity`,
    status: 200,
    response: ResourceActivitySchema,
  },
  stopResourceCommand: {
    method: "DELETE",
    path: `${API_PREFIX}/settings/resources/activity/:id`,
    status: 204,
    params: IdParams,
  },
  setProjectsFolder: {
    method: "PUT",
    path: `${API_PREFIX}/settings/projects-folder`,
    status: 204,
    body: Type.Object({ path: Type.String({ minLength: 1 }) }),
  },
  getSuggestedCodeFolder: {
    method: "GET",
    path: `${API_PREFIX}/settings/suggested-code-folder`,
    status: 200,
    response: SuggestedCodeFolderSchema,
  },
  suggestDirectories: {
    method: "POST",
    path: `${API_PREFIX}/fs/suggest`,
    status: 200,
    body: SuggestDirectoriesInputSchema,
    response: Type.Array(PathSuggestionSchema),
  },
  getGithubStatus: {
    method: "GET",
    path: `${API_PREFIX}/github/status`,
    status: 200,
    response: GithubStatusSchema,
  },
  listGithubRepos: {
    method: "GET",
    path: `${API_PREFIX}/github/repos`,
    status: 200,
    response: Type.Array(GithubRepoSchema),
  },
  refreshGithubRepos: {
    method: "POST",
    path: `${API_PREFIX}/github/repos/refresh`,
    status: 200,
    response: Type.Array(GithubRepoSchema),
  },
  useGithubRepo: {
    method: "POST",
    path: `${API_PREFIX}/github/use`,
    status: 201,
    body: UseGithubRepoInputSchema,
    response: ProjectSchema,
  },
  listProviders: {
    method: "GET",
    path: `${API_PREFIX}/providers`,
    status: 200,
    response: Type.Array(ProviderInfoSchema),
  },
  setProviderKey: {
    method: "PUT",
    path: `${API_PREFIX}/providers/:id/key`,
    status: 200,
    params: ProviderParams,
    body: Type.Object({ key: Type.String({ minLength: 1 }) }),
    response: ProviderInfoSchema,
  },
  disconnectProvider: {
    method: "DELETE",
    path: `${API_PREFIX}/providers/:id`,
    status: 200,
    params: ProviderParams,
    response: ProviderInfoSchema,
  },
  acknowledgeClaudeCli: {
    method: "POST",
    path: `${API_PREFIX}/providers/claude-cli/notice`,
    status: 200,
    response: ProviderInfoSchema,
  },
  refreshClaudeCli: {
    method: "POST",
    path: `${API_PREFIX}/providers/claude-cli/refresh`,
    status: 200,
    response: ProviderInfoSchema,
  },
  installClaudeCliSdk: {
    method: "POST",
    path: `${API_PREFIX}/providers/claude-cli/install`,
    status: 200,
    response: ProviderInfoSchema,
  },
  startLogin: {
    method: "POST",
    path: `${API_PREFIX}/providers/:id/login`,
    status: 201,
    params: ProviderParams,
    response: LoginSessionSchema,
  },
  getLogin: {
    method: "GET",
    path: `${API_PREFIX}/logins/:sid`,
    status: 200,
    params: SessionParams,
    response: LoginSessionSchema,
  },
  submitLoginUrl: {
    method: "POST",
    path: `${API_PREFIX}/logins/:sid/url`,
    status: 200,
    params: SessionParams,
    body: Type.Object({ url: Type.String({ minLength: 1, maxLength: 4096 }) }),
    response: LoginSessionSchema,
  },
  cancelLogin: { method: "DELETE", path: `${API_PREFIX}/logins/:sid`, status: 204, params: SessionParams },
  listModels: {
    method: "GET",
    path: `${API_PREFIX}/models`,
    status: 200,
    response: Type.Array(ModelInfoSchema),
  },
  /** Which executors this node offers a new thread, and what each supports. `claude-code` is listed even when off. */
  listRuntimes: {
    method: "GET",
    path: `${API_PREFIX}/runtimes`,
    status: 200,
    response: RuntimeDescriptorListSchema,
  },
  listProjects: {
    method: "GET",
    path: `${API_PREFIX}/projects`,
    status: 200,
    response: Type.Array(ProjectSchema),
  },
  addProject: {
    method: "POST",
    path: `${API_PREFIX}/projects`,
    status: 201,
    body: Type.Object({
      path: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String({ minLength: 1 })),
    }),
    response: ProjectSchema,
  },
  cloneProject: {
    method: "POST",
    path: `${API_PREFIX}/projects/clone`,
    status: 201,
    body: Type.Object({
      url: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String({ minLength: 1 })),
    }),
    response: ProjectSchema,
  },
  retryClone: {
    method: "POST",
    path: `${API_PREFIX}/projects/:id/retry-clone`,
    status: 204,
    params: IdParams,
  },
  renameProject: {
    method: "PATCH",
    path: `${API_PREFIX}/projects/:id`,
    status: 204,
    params: IdParams,
    body: Type.Object({ name: Type.String({ minLength: 1 }) }),
  },
  setProjectFolder: {
    method: "PUT",
    path: `${API_PREFIX}/projects/:id/folder`,
    status: 200,
    params: IdParams,
    body: Type.Object({ path: Type.String({ minLength: 1 }) }),
    response: ProjectSchema,
  },
  removeProject: { method: "DELETE", path: `${API_PREFIX}/projects/:id`, status: 204, params: IdParams },
  getProjectIcon: {
    method: "GET",
    path: `${API_PREFIX}/projects/:id/icon`,
    status: 200,
    params: IdParams,
    responseKind: "image",
  },
  setProjectIcon: {
    method: "PUT",
    path: `${API_PREFIX}/projects/:id/icon`,
    status: 204,
    params: IdParams,
    body: Type.Object({ png: Type.String({ minLength: 1 }) }),
    bodyLimit: ICON_BODY_LIMIT,
  },
  resetProjectIcon: {
    method: "DELETE",
    path: `${API_PREFIX}/projects/:id/icon`,
    status: 204,
    params: IdParams,
  },
  listIconCandidates: {
    method: "GET",
    path: `${API_PREFIX}/projects/:id/icon-candidates`,
    status: 200,
    params: IdParams,
    response: Type.Array(IconCandidateLinkSchema),
  },
  getIconCandidate: {
    method: "GET",
    path: `${API_PREFIX}/projects/:id/icon-candidates/file`,
    status: 200,
    params: IdParams,
    query: Type.Object({ name: Type.String({ minLength: 1 }) }),
    responseKind: "image",
  },
  suggestProjectFiles: {
    method: "POST",
    path: `${API_PREFIX}/projects/:id/files/suggest`,
    status: 200,
    params: IdParams,
    body: Type.Object({ query: Type.String({ maxLength: 500 }) }),
    response: Type.Array(FileSuggestionSchema),
  },
  listSkills: {
    method: "GET",
    path: `${API_PREFIX}/skills`,
    status: 200,
    query: Type.Object({ projectId: Type.Optional(Type.String({ minLength: 1 })) }),
    response: Type.Array(SkillSchema),
  },
  stageUpload: {
    method: "POST",
    path: `${API_PREFIX}/uploads`,
    status: 201,
    body: UploadInputSchema,
    response: FileRefSchema,
    bodyLimit: UPLOAD_BODY_LIMIT,
    ownerOnly: true,
  },
  listConversations: {
    method: "GET",
    path: `${API_PREFIX}/projects/:id/conversations`,
    status: 200,
    params: IdParams,
    response: Type.Array(ConversationSummarySchema),
  },
  listAllConversations: {
    method: "GET",
    path: `${API_PREFIX}/conversations`,
    status: 200,
    response: Type.Array(ConversationSummarySchema),
  },
  startConversation: {
    method: "POST",
    path: `${API_PREFIX}/conversations`,
    status: 201,
    body: StartConversationInputSchema,
    response: ConversationSummarySchema,
    bodyLimit: MESSAGE_BODY_LIMIT,
  },
  renameConversation: {
    method: "PATCH",
    path: `${API_PREFIX}/conversations/:id`,
    status: 204,
    params: IdParams,
    body: Type.Object({ title: Type.String({ minLength: 1 }) }),
  },
  sendMessage: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/messages`,
    status: 200,
    params: IdParams,
    body: SendMessageInputSchema,
    response: SendReceiptSchema,
    bodyLimit: MESSAGE_BODY_LIMIT,
  },
  updateTodos: {
    method: "PUT",
    path: `${API_PREFIX}/conversations/:id/todos`,
    status: 204,
    params: IdParams,
    body: UpdateTodosInputSchema,
  },
  archiveConversation: {
    method: "PUT",
    path: `${API_PREFIX}/conversations/:id/archived`,
    status: 204,
    params: IdParams,
    body: Type.Object({ archived: Type.Boolean() }),
  },
  deleteArchivedConversations: {
    method: "POST",
    path: `${API_PREFIX}/conversations/archived/delete`,
    status: 200,
    body: DeleteArchivedInputSchema,
    response: DeleteArchivedResultSchema,
  },
  removeConversation: {
    method: "DELETE",
    path: `${API_PREFIX}/conversations/:id`,
    status: 204,
    params: IdParams,
    query: ForceQuery,
  },
  configureConversation: {
    method: "PATCH",
    path: `${API_PREFIX}/conversations/:id/agent`,
    status: 204,
    params: IdParams,
    body: ConfigureConversationInputSchema,
  },
  retryConversation: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/retry`,
    status: 200,
    params: IdParams,
    body: RetryInputSchema,
    response: SendReceiptSchema,
  },
  compactConversation: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/compact`,
    status: 204,
    params: IdParams,
    body: CompactInputSchema,
  },
  abortConversation: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/abort`,
    status: 200,
    params: IdParams,
    response: AbortResultSchema,
  },
  stopAgent: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/stop-agent`,
    status: 204,
    params: IdParams,
  },
  forkConversation: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/fork`,
    status: 201,
    params: IdParams,
    body: EntryBody,
    response: ConversationSummarySchema,
  },
  /** What a contextual handoff to a new native thread would carry and lose; `canHandoff` is false with a `reason` when it cannot run now. */
  getHandoffPreview: {
    method: "GET",
    path: `${API_PREFIX}/conversations/:id/handoff-preview`,
    status: 200,
    params: IdParams,
    response: HandoffPreviewSchema,
  },
  /** Starts a NEW native thread from a text export of this Pi thread; the source is never changed. Idempotent by `requestId`. */
  handoffConversation: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/handoff`,
    status: 201,
    params: IdParams,
    body: HandoffInputSchema,
    response: ConversationSummarySchema,
  },
  rewindPreview: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/rewind/preview`,
    status: 200,
    params: IdParams,
    body: EntryBody,
    response: RestorePreviewSchema,
  },
  rewindConversation: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/rewind`,
    status: 200,
    params: IdParams,
    body: EntryBody,
    response: Type.Object({ conversation: ConversationSummarySchema, draft: Type.String() }),
  },
  sendNow: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/send-now`,
    status: 200,
    params: IdParams,
    body: SendNowInputSchema,
    response: SendNowResultSchema,
  },
  cancelQueued: {
    method: "DELETE",
    path: `${API_PREFIX}/conversations/:id/queue/:itemId`,
    status: 200,
    params: QueueItemParams,
    response: CancelQueuedResultSchema,
  },
  setQueuedMode: {
    method: "PATCH",
    path: `${API_PREFIX}/conversations/:id/queue/:itemId`,
    status: 200,
    params: QueueItemParams,
    body: Type.Object({ mode: WhenBusySchema }),
    response: SetQueuedModeResultSchema,
  },
  listCheckpoints: {
    method: "GET",
    path: `${API_PREFIX}/conversations/:id/checkpoints`,
    status: 200,
    params: IdParams,
    response: Type.Array(CheckpointSchema),
  },
  getCheckpointDiff: {
    method: "GET",
    path: `${API_PREFIX}/conversations/:id/checkpoints/:cid/diff`,
    status: 200,
    params: CheckpointParams,
    query: Type.Object({ path: Type.String({ minLength: 1 }) }),
    response: Type.Object({ diff: Type.String() }),
  },
  getWorkspace: {
    method: "GET",
    path: `${API_PREFIX}/conversations/:id/workspace`,
    status: 200,
    params: IdParams,
    response: WorkspaceStatusSchema,
  },
  mergeWorkspace: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/workspace/merge`,
    status: 200,
    params: IdParams,
    query: ForceQuery,
    response: ConversationSummarySchema,
  },
  createPullRequest: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/workspace/pull-request`,
    status: 200,
    params: IdParams,
    response: ConversationSummarySchema,
  },
  removeWorkspace: {
    method: "DELETE",
    path: `${API_PREFIX}/conversations/:id/workspace`,
    status: 200,
    params: IdParams,
    query: ForceQuery,
    response: ConversationSummarySchema,
  },
  listProcesses: {
    method: "GET",
    path: `${API_PREFIX}/conversations/:id/processes`,
    status: 200,
    params: IdParams,
    response: Type.Array(ProcessInfoSchema),
  },
  getProcessLogs: {
    method: "GET",
    path: `${API_PREFIX}/processes/:id/logs`,
    status: 200,
    params: IdParams,
    query: Type.Object({ tail: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,3}$" })) }),
    response: Type.Object({ logs: Type.String() }),
  },
  stopProcess: { method: "DELETE", path: `${API_PREFIX}/processes/:id`, status: 204, params: IdParams },
  backgroundToolCall: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/tool-calls/:callId/background`,
    status: 200,
    params: ToolCallParams,
    response: ProcessInfoSchema,
  },
  stopToolCall: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/tool-calls/:callId/stop`,
    status: 204,
    params: ToolCallParams,
  },
  getTerminalsAvailable: {
    method: "GET",
    path: `${API_PREFIX}/terminals/available`,
    status: 200,
    response: TerminalAvailabilitySchema,
  },
  listTerminals: {
    method: "GET",
    path: `${API_PREFIX}/conversations/:id/terminals`,
    status: 200,
    params: IdParams,
    response: Type.Array(TerminalInfoSchema),
  },
  openTerminal: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/terminals`,
    status: 200,
    params: IdParams,
    body: OpenTerminalInputSchema,
    response: TerminalInfoSchema,
  },
  closeTerminal: { method: "DELETE", path: `${API_PREFIX}/terminals/:id`, status: 204, params: IdParams },
  listApprovals: {
    method: "GET",
    path: `${API_PREFIX}/conversations/:id/approvals`,
    status: 200,
    params: IdParams,
    response: Type.Array(ApprovalSchema),
  },
  decideApproval: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/approvals/:toolUseId`,
    status: 204,
    params: ApprovalParams,
    body: Type.Object({ decision: ApprovalDecisionSchema }),
  },
  listTimers: {
    method: "GET",
    path: `${API_PREFIX}/conversations/:id/timers`,
    status: 200,
    params: IdParams,
    response: Type.Array(TimerSchema),
  },
  deleteTimer: { method: "DELETE", path: `${API_PREFIX}/timers/:id`, status: 204, params: IdParams },
  startLoop: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/loop`,
    status: 204,
    params: IdParams,
    body: LoopInputSchema,
  },
  stopLoop: { method: "DELETE", path: `${API_PREFIX}/conversations/:id/loop`, status: 204, params: IdParams },
  getGoal: {
    method: "GET",
    path: `${API_PREFIX}/conversations/:id/goal`,
    status: 200,
    params: IdParams,
    response: Type.Union([GoalSchema, Type.Null()]),
  },
  setGoal: {
    method: "PUT",
    path: `${API_PREFIX}/conversations/:id/goal`,
    status: 204,
    params: IdParams,
    body: GoalInputSchema,
  },
  clearGoal: {
    method: "DELETE",
    path: `${API_PREFIX}/conversations/:id/goal`,
    status: 204,
    params: IdParams,
  },
  listMcpServers: {
    method: "GET",
    path: `${API_PREFIX}/mcp/servers`,
    status: 200,
    query: Type.Object({ projectId: Type.Optional(Type.String({ minLength: 1 })) }),
    response: Type.Array(McpServerStatusSchema),
  },
  saveMcpServer: {
    method: "PUT",
    path: `${API_PREFIX}/mcp/servers/:name`,
    status: 204,
    params: NameParams,
    body: McpServerConfigSchema,
  },
  removeMcpServer: {
    method: "DELETE",
    path: `${API_PREFIX}/mcp/servers/:name`,
    status: 204,
    params: NameParams,
  },
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof routes;
export type ImageRouteName = {
  [N in RouteName]: (typeof routes)[N] extends { responseKind: "image" } ? N : never;
}[RouteName];
export type JsonRouteName = Exclude<RouteName, ImageRouteName>;

/** The `src` of a candidate image; the name is query-encoded. */
export function iconCandidateUrl(projectId: string, name: string): string {
  const path = fillPath(routes.getIconCandidate.path, { id: projectId });
  return `${path}?name=${encodeURIComponent(name)}`;
}

type StaticOf<S> = S extends TSchema ? Type.Static<S> : never;

export type RouteInput<R extends RouteDef> = (R extends { params: infer P }
  ? { params: StaticOf<P> }
  : unknown) &
  (R extends { query: infer Q } ? { query: StaticOf<Q> } : unknown) &
  (R extends { body: infer B } ? { body: StaticOf<B> } : unknown);

export type RouteOutput<R extends RouteDef> = R extends { response: infer S } ? StaticOf<S> : undefined;

export function fillPath(path: string, params: Record<string, string> | undefined): string {
  return path.replace(/:(\w+)/g, (_match, name: string) => encodeURIComponent(params?.[name] ?? ""));
}

/** The URL of a project's icon; `version` is the custom icon's hash, or "auto". */
export function projectIconUrl(projectId: string, version: string): string {
  return `${API_PREFIX}/projects/${encodeURIComponent(projectId)}/icon?v=${encodeURIComponent(version)}`;
}
