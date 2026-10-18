import { type TSchema, Type } from "typebox";
import { DeleteArchivedInputSchema, DeleteArchivedResultSchema } from "./archived";
import {
  ClaudeConnectorSettingsSchema,
  CompactInputSchema,
  ConfigureConversationInputSchema,
  ConversationSummarySchema,
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
  SettingsSchema,
  SkillSchema,
  StartConversationInputSchema,
  SuggestDirectoriesInputSchema,
  SuggestedCodeFolderSchema,
  ThinkingLevelSchema,
  UseGithubRepoInputSchema,
  WorkspaceDefaultSchema,
} from "./entities";
import { ICON_BODY_LIMIT } from "./icons";
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

export const API_PREFIX = "/api";
export const LIVE_PATH = `${API_PREFIX}/live`;

export const MESSAGE_BODY_LIMIT = 42 * 1024 * 1024;
export const PROCESS_LOG_TAIL_DEFAULT = 200;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteDef {
  readonly method: HttpMethod;
  readonly path: string;
  readonly status: 200 | 201 | 204;
  readonly params?: TSchema;
  readonly query?: TSchema;
  /** `image` routes answer raw bytes (cookie-authenticated GET, used as `<img src>`); the default is JSON. */
  readonly responseKind?: "json" | "image";
  readonly body?: TSchema;
  readonly response?: TSchema;
  readonly bodyLimit?: number;
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
const ForceQuery = Type.Object({
  force: Type.Optional(Type.Union([Type.Literal("true"), Type.Literal("false")])),
});
const NameParams = Type.Object({ name: Type.String({ minLength: 1 }) });
const EntryBody = Type.Object({ entryId: Type.String({ minLength: 1 }) });

export const routes = {
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
    status: 204,
    params: IdParams,
    body: SendMessageInputSchema,
    bodyLimit: MESSAGE_BODY_LIMIT,
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
    status: 204,
    params: IdParams,
    body: RetryInputSchema,
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
    status: 204,
    params: IdParams,
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
  cancelQueued: {
    method: "DELETE",
    path: `${API_PREFIX}/conversations/:id/queue/:itemId`,
    status: 200,
    params: QueueItemParams,
    response: Type.Object({ cancelled: Type.Boolean() }),
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
