import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { GoalSummarySchema } from "./mvp8";
import { RemoteSettingsSchema } from "./remote";
import { ResourceSettingsSchema } from "./resources";
import { ExecutorKindSchema } from "./runtime";
import { SandboxSettingsSchema } from "./sandbox";

export const ModelRefSchema = Type.Object({ provider: Type.String(), modelId: Type.String() });
export type ModelRef = Type.Static<typeof ModelRefSchema>;

export const ThinkingLevelSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);
export type ThinkingLevel = Type.Static<typeof ThinkingLevelSchema>;

export const VoiceModelSettingSchema = Type.Union([
  Type.Object({ kind: Type.Literal("local") }),
  Type.Object({
    kind: Type.Literal("provider"),
    provider: Type.String({ minLength: 1 }),
    modelId: Type.String({ minLength: 1 }),
  }),
  Type.Null(),
]);
export type VoiceModelSetting = Type.Static<typeof VoiceModelSettingSchema>;

/** Bytes the client decoded (local path) or recorded (provider path); transcribed and discarded, never stored. */
export const TranscribeInputSchema = Type.Union([
  Type.Object({
    format: Type.Literal("pcm-f32"),
    sampleRate: Type.Number({ minimum: 8000, maximum: 192000 }),
    data: Type.String({ maxLength: 14 * 1024 * 1024 }),
  }),
  Type.Object({
    format: Type.Literal("blob"),
    mimeType: Type.Union([Type.Literal("audio/webm"), Type.Literal("audio/mp4")]),
    data: Type.String({ maxLength: 14 * 1024 * 1024 }),
  }),
]);
export type TranscribeInput = Type.Static<typeof TranscribeInputSchema>;

export const VoiceOptionsSchema = Type.Object({
  local: Type.Object({
    available: Type.Boolean(),
    state: Type.Union([
      Type.Literal("ready"),
      Type.Literal("needs-download"),
      Type.Literal("downloading"),
      Type.Literal("error"),
    ]),
    error: Type.Optional(Type.String()),
    progress: Type.Optional(
      Type.Object({
        file: Type.String(),
        downloaded: Type.Number({ minimum: 0 }),
        total: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
      }),
    ),
  }),
  providers: Type.Array(
    Type.Object({
      provider: Type.String(),
      providerName: Type.String(),
      models: Type.Array(Type.Object({ modelId: Type.String(), name: Type.String() })),
      error: Type.Optional(Type.String()),
    }),
  ),
});
export type VoiceOptions = Type.Static<typeof VoiceOptionsSchema>;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const thinkingLevelMatchesPi: Equal<ThinkingLevel, ModelThinkingLevel> = true;
void thinkingLevelMatchesPi;

export const ModelInfoSchema = Type.Object({
  provider: Type.String(),
  modelId: Type.String(),
  name: Type.String(),
  contextWindow: Type.Number(),
  reasoning: Type.Boolean(),
  images: Type.Boolean(),
  thinkingLevels: Type.Array(ThinkingLevelSchema),
  providerName: Type.String(),
  cost: Type.Optional(Type.Object({ input: Type.Number(), output: Type.Number() })),
  billing: Type.Optional(Type.Union([Type.Literal("usage"), Type.Literal("subscription")])),
});
export type ModelInfo = Type.Static<typeof ModelInfoSchema>;

export const MessageModeSchema = Type.Union([Type.Literal("steer"), Type.Literal("queue")]);
export type MessageMode = Type.Static<typeof MessageModeSchema>;

export const WorkspaceModeSchema = Type.Union([Type.Literal("worktree"), Type.Literal("checkout")]);
export type WorkspaceMode = Type.Static<typeof WorkspaceModeSchema>;

export const WorkspaceDefaultSchema = Type.Union([WorkspaceModeSchema, Type.Literal("per-project")]);
export type WorkspaceDefault = Type.Static<typeof WorkspaceDefaultSchema>;

export const ThreadWorkspaceSchema = Type.Object({
  mode: WorkspaceModeSchema,
  path: Type.String(),
  branch: Type.Union([Type.String(), Type.Null()]),
  base: Type.Union([Type.String(), Type.Null()]),
  state: Type.Union([Type.Literal("ready"), Type.Literal("merged"), Type.Literal("removed")]),
  mergedSha: Type.Union([Type.String(), Type.Null()]),
  pullRequestUrl: Type.Union([Type.String(), Type.Null()]),
});
export type ThreadWorkspace = Type.Static<typeof ThreadWorkspaceSchema>;

export const ClaudeConnectorSettingsSchema = Type.Object({
  /** Servers the user switched off. Every other connected connector is on. */
  disabled: Type.Array(Type.String()),
  alwaysAllow: Type.Array(Type.String()),
  askBeforeWrites: Type.Boolean(),
});
export type ClaudeConnectorSettings = Type.Static<typeof ClaudeConnectorSettingsSchema>;

export const CompactionSettingsSchema = Type.Object({
  mode: Type.Union([Type.Literal("summary"), Type.Literal("fast")]),
  backend: Type.Union([Type.Literal("auto"), Type.Literal("typesafe"), Type.Literal("openai")]),
});
export type CompactionSettings = Type.Static<typeof CompactionSettingsSchema>;

export const SettingsSchema = Type.Object({
  defaultModel: Type.Union([ModelRefSchema, Type.Null()]),
  defaultThinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()]),
  fastModel: Type.Union([ModelRefSchema, Type.Null()]),
  fastThinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()]),
  projectsFolder: Type.String(),
  messageMode: MessageModeSchema,
  workspaceDefault: WorkspaceDefaultSchema,
  claudeCliNoticeAt: Type.Union([Type.Number(), Type.Null()]),
  claudeConnectors: ClaudeConnectorSettingsSchema,
  remote: RemoteSettingsSchema,
  /** Optional only so a web can read an older node (the response is validated): absent means "not supported there". A current node always sends it. */
  resources: Type.Optional(ResourceSettingsSchema),
  /** Phase 1: persisted only, never enforced (staging gate: all false). Absent means "not supported there", like `resources`. */
  sandbox: Type.Optional(SandboxSettingsSchema),
  /** Which speech-to-text the composer uses; `null`/absent is the browser fallback. Absent means "not supported there", like `resources`. */
  voiceModel: Type.Optional(VoiceModelSettingSchema),
  /** Fast-compaction preference. Optional so an older node still validates; a current node always sends it. */
  compaction: Type.Optional(CompactionSettingsSchema),
  /** "Use my other nodes": the user skipped first-run setup here because a peer can run threads. Server-side so a fresh browser does not see setup again. */
  setupSkipped: Type.Boolean(),
});
export type Settings = Type.Static<typeof SettingsSchema>;

export const ProviderIdSchema = Type.Union([
  Type.Literal("openrouter"),
  Type.Literal("openai"),
  Type.Literal("anthropic"),
  Type.Literal("google"),
  Type.Literal("opencode"),
  Type.Literal("claude-cli"),
  Type.Literal("typesafe"),
]);
export type ProviderId = Type.Static<typeof ProviderIdSchema>;

export const ProviderMethodSchema = Type.Union([
  Type.Literal("api_key"),
  Type.Literal("chatgpt"),
  Type.Literal("claude_cli"),
]);
export type ProviderMethod = Type.Static<typeof ProviderMethodSchema>;

export const ProviderConnectionSchema = Type.Object({
  method: ProviderMethodSchema,
  source: Type.Union([Type.Literal("file"), Type.Literal("env"), Type.Literal("cli")]),
  valid: Type.Union([Type.Boolean(), Type.Null()]),
});
export type ProviderConnection = Type.Static<typeof ProviderConnectionSchema>;

export const ClaudeCliStateSchema = Type.Union([
  Type.Literal("ready"),
  Type.Literal("needs_notice"),
  Type.Literal("missing"),
  Type.Literal("logged_out"),
  Type.Literal("not_plan"),
  Type.Literal("blocked"),
  Type.Literal("error"),
  Type.Literal("sdk_missing"),
]);
export type ClaudeCliState = Type.Static<typeof ClaudeCliStateSchema>;

export const ClaudeCliUsageSchema = Type.Object({
  status: Type.Union([Type.Literal("allowed"), Type.Literal("allowed_warning"), Type.Literal("rejected")]),
  fiveHour: Type.Union([Type.Number(), Type.Null()]),
  resetsAt: Type.Union([Type.Number(), Type.Null()]),
  updatedAt: Type.Number(),
});
export type ClaudeCliUsage = Type.Static<typeof ClaudeCliUsageSchema>;

export const ClaudeConnectorStatusSchema = Type.Union([
  Type.Literal("connected"),
  Type.Literal("needs_auth"),
  Type.Literal("failed"),
  Type.Literal("disabled"),
  Type.Literal("pending"),
]);
export type ClaudeConnectorStatus = Type.Static<typeof ClaudeConnectorStatusSchema>;

/** No tool schemas over the wire. */
export const ClaudeConnectorSchema = Type.Object({
  name: Type.String(),
  source: Type.Union([Type.Literal("claudeai"), Type.Literal("user")]),
  status: ClaudeConnectorStatusSchema,
  toolCount: Type.Number(),
  readOnlyCount: Type.Number(),
});
export type ClaudeConnector = Type.Static<typeof ClaudeConnectorSchema>;

/** No email, no ids, no tokens. */
export const ClaudeCliStatusSchema = Type.Object({
  state: ClaudeCliStateSchema,
  plan: Type.Union([Type.String(), Type.Null()]),
  org: Type.Union([Type.String(), Type.Null()]),
  cliVersion: Type.Union([Type.String(), Type.Null()]),
  sdkCliVersion: Type.Union([Type.String(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
  usage: Type.Union([ClaudeCliUsageSchema, Type.Null()]),
  processCount: Type.Number(),
  /** `null` until a probe ran, or when the probe failed. */
  connectors: Type.Union([Type.Array(ClaudeConnectorSchema), Type.Null()]),
});
export type ClaudeCliStatus = Type.Static<typeof ClaudeCliStatusSchema>;

export const DecisionsAvailabilitySchema = Type.Union([
  Type.Literal("ready"),
  Type.Literal("unavailable"),
  Type.Literal("checking"),
  Type.Literal("unknown"),
]);
export type DecisionsAvailability = Type.Static<typeof DecisionsAvailabilitySchema>;

export const ProviderInfoSchema = Type.Object({
  id: ProviderIdSchema,
  name: Type.String(),
  methods: Type.Array(ProviderMethodSchema),
  keyUrl: Type.String(),
  connection: Type.Union([ProviderConnectionSchema, Type.Null()]),
  cli: Type.Union([ClaudeCliStatusSchema, Type.Null()]),
  decisions: Type.Optional(DecisionsAvailabilitySchema),
});
export type ProviderInfo = Type.Static<typeof ProviderInfoSchema>;

export const LoginStateSchema = Type.Union([
  Type.Literal("starting"),
  Type.Literal("waiting"),
  Type.Literal("done"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);
export type LoginState = Type.Static<typeof LoginStateSchema>;

export const LoginSessionSchema = Type.Object({
  id: Type.String(),
  provider: Type.Literal("openai"),
  method: Type.Literal("chatgpt"),
  state: LoginStateSchema,
  authUrl: Type.Union([Type.String(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
});
export type LoginSession = Type.Static<typeof LoginSessionSchema>;

export const FileSuggestionSchema = Type.Object({
  path: Type.String(),
  kind: Type.Union([Type.Literal("file"), Type.Literal("directory")]),
});
export type FileSuggestion = Type.Static<typeof FileSuggestionSchema>;

export const SkillSchema = Type.Object({
  name: Type.String(),
  description: Type.String(),
  scope: Type.Union([Type.Literal("project"), Type.Literal("user"), Type.Literal("app")]),
  path: Type.String(),
});
export type Skill = Type.Static<typeof SkillSchema>;

export const COMPACT_INSTRUCTIONS_MAX_LENGTH = 2000;
export const CompactInputSchema = Type.Object({
  instructions: Type.Optional(Type.String({ maxLength: COMPACT_INSTRUCTIONS_MAX_LENGTH })),
});
export type CompactInput = Type.Static<typeof CompactInputSchema>;

export const ProjectKindSchema = Type.Union([
  Type.Literal("home"),
  Type.Literal("folder"),
  Type.Literal("git"),
]);
export type ProjectKind = Type.Static<typeof ProjectKindSchema>;

export const ProjectStatusSchema = Type.Union([
  Type.Literal("ready"),
  Type.Literal("cloning"),
  Type.Literal("failed"),
]);
export type ProjectStatus = Type.Static<typeof ProjectStatusSchema>;

export const ProjectSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  path: Type.String(),
  createdAt: Type.Number(),
  kind: ProjectKindSchema,
  gitUrl: Type.Optional(Type.String()),
  status: ProjectStatusSchema,
  isGitRepo: Type.Boolean(),
  error: Type.Optional(Type.String()),
  iconUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  lastWorkspaceMode: Type.Optional(WorkspaceModeSchema),
});
export type Project = Type.Static<typeof ProjectSchema>;

export const ConversationStatusSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("running"),
  Type.Literal("error"),
]);
export type ConversationStatus = Type.Static<typeof ConversationStatusSchema>;

export const AgentStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("done"),
  Type.Literal("failed"),
  Type.Literal("stopped"),
]);
export type AgentStatus = Type.Static<typeof AgentStatusSchema>;

export const SUBAGENT_NOTIFICATION_KIND = "app.subagent_notification";

export const SubagentNotificationDataSchema = Type.Object({
  childId: Type.String(),
  status: Type.Union([Type.Literal("done"), Type.Literal("failed"), Type.Literal("stopped")]),
  title: Type.String(),
  report: Type.String(),
});
export type SubagentNotificationData = Type.Static<typeof SubagentNotificationDataSchema>;

export const ConversationSummarySchema = Type.Object({
  id: Type.String(),
  projectId: Type.String(),
  title: Type.String(),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  archivedAt: Type.Union([Type.Number(), Type.Null()]),
  status: ConversationStatusSchema,
  lastRunEndedAt: Type.Union([Type.Number(), Type.Null()]),
  avatarIndex: Type.Number(),
  lastActivityAt: Type.Number(),
  model: Type.Union([ModelRefSchema, Type.Null()]),
  workspace: ThreadWorkspaceSchema,
  forkOf: Type.Union([Type.Object({ conversationId: Type.String(), entryId: Type.String() }), Type.Null()]),
  parentId: Type.Union([Type.String(), Type.Null()]),
  agentType: Type.Union([Type.String(), Type.Null()]),
  agentModel: Type.Union([ModelRefSchema, Type.Null()]),
  agentStatus: Type.Union([AgentStatusSchema, Type.Null()]),
  background: Type.Boolean(),
  agentThinking: Type.Union([ThinkingLevelSchema, Type.Null()]),
  timers: Type.Number(),
  nextTimerAt: Type.Union([Type.String(), Type.Null()]),
  goal: Type.Union([GoalSummarySchema, Type.Null()]),
  unmergedWarning: Type.Union([Type.String(), Type.Null()]),
  executor: Type.Optional(ExecutorKindSchema),
});
export type ConversationSummary = Type.Static<typeof ConversationSummarySchema>;

export const ChangeSchema = Type.Union([
  Type.Object({ resource: Type.Literal("projects") }),
  Type.Object({ resource: Type.Literal("providers") }),
  Type.Object({ resource: Type.Literal("conversations"), projectId: Type.String() }),
  Type.Object({ resource: Type.Literal("processes"), conversationId: Type.String() }),
  Type.Object({ resource: Type.Literal("terminals"), conversationId: Type.String() }),
  Type.Object({ resource: Type.Literal("timers"), conversationId: Type.String() }),
  Type.Object({ resource: Type.Literal("mcp") }),
  Type.Object({ resource: Type.Literal("approvals"), conversationId: Type.String() }),
  Type.Object({ resource: Type.Literal("remote") }),
  Type.Object({ resource: Type.Literal("devices") }),
  Type.Object({ resource: Type.Literal("nodes") }),
  /** Node-wide: a heavy command queued, started, finished or was cancelled. Not per conversation. */
  Type.Object({ resource: Type.Literal("resources") }),
]);
export type Change = Type.Static<typeof ChangeSchema>;

export const MAX_IMAGE_BASE64_LENGTH = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 16;

export const ImageInputSchema = Type.Object({
  mimeType: Type.Union([
    Type.Literal("image/png"),
    Type.Literal("image/jpeg"),
    Type.Literal("image/webp"),
    Type.Literal("image/gif"),
  ]),
  data: Type.String({ maxLength: MAX_IMAGE_BASE64_LENGTH }),
});
export type ImageInput = Type.Static<typeof ImageInputSchema>;

/** At most 5 MiB of decoded bytes; the HTTP body limit (`UPLOAD_BODY_LIMIT`) is what bounds `data` on the wire. */
export const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;

/** A staged upload: `path` is a virtual path under `uploads/` that only the agent resolves, never bytes on the wire. */
export const FileRefSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  path: Type.String({ minLength: 1, maxLength: 1024 }),
  size: Type.Integer({ minimum: 0, maximum: MAX_UPLOAD_FILE_BYTES }),
});
export type FileRef = Type.Static<typeof FileRefSchema>;
export const UploadInputSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  mimeType: Type.String({ minLength: 1, maxLength: 128 }),
  data: Type.String({ minLength: 1 }),
});
export type UploadInput = Type.Static<typeof UploadInputSchema>;

const SendMessageFields = {
  text: Type.String(),
  images: Type.Optional(Type.Array(ImageInputSchema, { maxItems: MAX_IMAGES_PER_MESSAGE })),
  files: Type.Optional(Type.Array(FileRefSchema)),
  requestId: Type.String({ minLength: 1 }),
};

export const WhenBusySchema = Type.Union([Type.Literal("steer"), Type.Literal("followUp")]);
export type WhenBusy = Type.Static<typeof WhenBusySchema>;

export const SendMessageInputSchema = Type.Object({
  ...SendMessageFields,
  whenBusy: Type.Optional(WhenBusySchema),
});
export type SendMessageInput = Type.Static<typeof SendMessageInputSchema>;

export const StartConversationInputSchema = Type.Object({
  ...SendMessageFields,
  projectId: Type.String({ minLength: 1 }),
  model: Type.Optional(ModelRefSchema),
  thinkingLevel: Type.Optional(ThinkingLevelSchema),
  workspace: Type.Optional(WorkspaceModeSchema),
  /** Omitted means Pi. `claude-code` is refused with `invalid_request` unless the node enables it. */
  executor: Type.Optional(ExecutorKindSchema),
});
export type StartConversationInput = Type.Static<typeof StartConversationInputSchema>;

export const ConfigureConversationInputSchema = Type.Object(
  { model: Type.Optional(ModelRefSchema), thinkingLevel: Type.Optional(ThinkingLevelSchema) },
  { minProperties: 1 },
);
export type ConfigureConversationInput = Type.Static<typeof ConfigureConversationInputSchema>;

export const RetryInputSchema = Type.Object({ requestId: Type.String({ minLength: 1 }) });
export type RetryInput = Type.Static<typeof RetryInputSchema>;

export const SendReceiptSchema = Type.Object({
  submissionId: Type.Number(),
  entryId: Type.Optional(Type.Number()),
});
export type SendReceipt = Type.Static<typeof SendReceiptSchema>;

export const UserItemSnapshotSchema = Type.Object({
  text: Type.String(),
  files: Type.Array(FileRefSchema),
});
export type UserItemSnapshot = Type.Static<typeof UserItemSnapshotSchema>;

export const AbortResultSchema = Type.Object({ restored: Type.Array(UserItemSnapshotSchema) });
export type AbortResult = Type.Static<typeof AbortResultSchema>;

export const CancelQueuedResultSchema = Type.Object({
  cancelled: Type.Boolean(),
  restored: Type.Array(UserItemSnapshotSchema),
});
export type CancelQueuedResult = Type.Static<typeof CancelQueuedResultSchema>;

export const SendNowInputSchema = Type.Object({ itemId: Type.String({ minLength: 1 }) });
export type SendNowInput = Type.Static<typeof SendNowInputSchema>;

export const SendNowResultSchema = Type.Object({
  submissionId: Type.Number(),
  entryId: Type.Optional(Type.Number()),
  restored: Type.Array(UserItemSnapshotSchema),
});
export type SendNowResult = Type.Static<typeof SendNowResultSchema>;

export const SetQueuedModeResultSchema = Type.Object({
  switched: Type.Boolean(),
});
export type SetQueuedModeResult = Type.Static<typeof SetQueuedModeResultSchema>;

export const GithubStatusSchema = Type.Union([
  Type.Object({
    state: Type.Literal("connected"),
    login: Type.String(),
    gitProtocol: Type.Union([Type.Literal("https"), Type.Literal("ssh")]),
    tokenSource: Type.String(),
  }),
  Type.Object({ state: Type.Literal("not_installed") }),
  Type.Object({ state: Type.Literal("not_logged_in"), hint: Type.String() }),
  Type.Object({ state: Type.Literal("error"), message: Type.String() }),
]);
export type GithubStatus = Type.Static<typeof GithubStatusSchema>;

export const GithubRepoSchema = Type.Object({
  nameWithOwner: Type.String({ pattern: "^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$" }),
  description: Type.Union([Type.String(), Type.Null()]),
  private: Type.Boolean(),
  pushedAt: Type.Number(),
  localPath: Type.Union([Type.String(), Type.Null()]),
  projectId: Type.Union([Type.String(), Type.Null()]),
});
export type GithubRepo = Type.Static<typeof GithubRepoSchema>;

export const UseGithubRepoInputSchema = Type.Object({
  nameWithOwner: Type.String({ pattern: "^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$" }),
  mode: Type.Union([Type.Literal("local"), Type.Literal("clone"), Type.Literal("folder")]),
  path: Type.Optional(Type.String({ minLength: 1 })),
});
export type UseGithubRepoInput = Type.Static<typeof UseGithubRepoInputSchema>;

export const SuggestedCodeFolderSchema = Type.Union([Type.Object({ path: Type.String() }), Type.Null()]);
export type SuggestedCodeFolder = Type.Static<typeof SuggestedCodeFolderSchema>;

export const PathSuggestionSchema = Type.Object({
  path: Type.String(),
  display: Type.String(),
  isGitRepo: Type.Boolean(),
});
export type PathSuggestion = Type.Static<typeof PathSuggestionSchema>;

export const SuggestDirectoriesInputSchema = Type.Object({
  prefix: Type.String(),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});
export type SuggestDirectoriesInput = Type.Static<typeof SuggestDirectoriesInputSchema>;

export const IconCandidateSchema = Type.Object({ name: Type.String({ minLength: 1 }) });
export type IconCandidate = Type.Static<typeof IconCandidateSchema>;

export const IconCandidateLinkSchema = Type.Object({ name: Type.String(), url: Type.String() });
export type IconCandidateLink = Type.Static<typeof IconCandidateLinkSchema>;

export type ProjectIconImage = { contentType: string; data: Uint8Array; etag?: string };
