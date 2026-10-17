import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "typebox";

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
});
export type ModelInfo = Type.Static<typeof ModelInfoSchema>;

export const MessageModeSchema = Type.Union([Type.Literal("steer"), Type.Literal("queue")]);
export type MessageMode = Type.Static<typeof MessageModeSchema>;

export const WorkspaceModeSchema = Type.Union([Type.Literal("worktree"), Type.Literal("checkout")]);
export type WorkspaceMode = Type.Static<typeof WorkspaceModeSchema>;

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

export const SettingsSchema = Type.Object({
  defaultModel: Type.Union([ModelRefSchema, Type.Null()]),
  defaultThinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()]),
  fastModel: Type.Union([ModelRefSchema, Type.Null()]),
  fastThinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()]),
  projectsFolder: Type.String(),
  messageMode: MessageModeSchema,
  workspaceDefault: WorkspaceModeSchema,
});
export type Settings = Type.Static<typeof SettingsSchema>;

export const ProviderIdSchema = Type.Union([
  Type.Literal("openrouter"),
  Type.Literal("openai"),
  Type.Literal("anthropic"),
  Type.Literal("google"),
  Type.Literal("opencode"),
]);
export type ProviderId = Type.Static<typeof ProviderIdSchema>;

export const ProviderMethodSchema = Type.Union([Type.Literal("api_key"), Type.Literal("chatgpt")]);
export type ProviderMethod = Type.Static<typeof ProviderMethodSchema>;

export const ProviderConnectionSchema = Type.Object({
  method: ProviderMethodSchema,
  source: Type.Union([Type.Literal("file"), Type.Literal("env")]),
  valid: Type.Union([Type.Boolean(), Type.Null()]),
});
export type ProviderConnection = Type.Static<typeof ProviderConnectionSchema>;

export const ProviderInfoSchema = Type.Object({
  id: ProviderIdSchema,
  name: Type.String(),
  methods: Type.Array(ProviderMethodSchema),
  keyUrl: Type.String(),
  connection: Type.Union([ProviderConnectionSchema, Type.Null()]),
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
  scope: Type.Union([Type.Literal("project"), Type.Literal("user")]),
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
});
export type Project = Type.Static<typeof ProjectSchema>;

export const ConversationStatusSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("running"),
  Type.Literal("error"),
]);
export type ConversationStatus = Type.Static<typeof ConversationStatusSchema>;

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
});
export type ConversationSummary = Type.Static<typeof ConversationSummarySchema>;

export const ChangeSchema = Type.Union([
  Type.Object({ resource: Type.Literal("projects") }),
  Type.Object({ resource: Type.Literal("providers") }),
  Type.Object({ resource: Type.Literal("conversations"), projectId: Type.String() }),
  Type.Object({ resource: Type.Literal("processes"), conversationId: Type.String() }),
  Type.Object({ resource: Type.Literal("mcp") }),
]);
export type Change = Type.Static<typeof ChangeSchema>;

export const MAX_IMAGE_BASE64_LENGTH = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 8;

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

const SendMessageFields = {
  text: Type.String(),
  images: Type.Optional(Type.Array(ImageInputSchema, { maxItems: MAX_IMAGES_PER_MESSAGE })),
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
});
export type StartConversationInput = Type.Static<typeof StartConversationInputSchema>;

export const ConfigureConversationInputSchema = Type.Object(
  { model: Type.Optional(ModelRefSchema), thinkingLevel: Type.Optional(ThinkingLevelSchema) },
  { minProperties: 1 },
);
export type ConfigureConversationInput = Type.Static<typeof ConfigureConversationInputSchema>;

export const RetryInputSchema = Type.Object({ requestId: Type.String({ minLength: 1 }) });
export type RetryInput = Type.Static<typeof RetryInputSchema>;

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
