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
});
export type ModelInfo = Type.Static<typeof ModelInfoSchema>;

export const SettingsSchema = Type.Object({
  defaultModel: Type.Union([ModelRefSchema, Type.Null()]),
  fastModel: Type.Union([ModelRefSchema, Type.Null()]),
  projectsFolder: Type.String(),
});
export type Settings = Type.Static<typeof SettingsSchema>;

export const ProviderStatusSchema = Type.Object({
  provider: Type.String(),
  configured: Type.Boolean(),
  source: Type.Union([Type.Literal("file"), Type.Literal("env"), Type.Null()]),
  valid: Type.Union([Type.Boolean(), Type.Null()]),
});
export type ProviderStatus = Type.Static<typeof ProviderStatusSchema>;

export const ProjectKindSchema = Type.Union([Type.Literal("home"), Type.Literal("folder"), Type.Literal("git")]);
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
  error: Type.Optional(Type.String()),
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
});
export type ConversationSummary = Type.Static<typeof ConversationSummarySchema>;

export const ChangeSchema = Type.Union([
  Type.Object({ resource: Type.Literal("projects") }),
  Type.Object({ resource: Type.Literal("conversations"), projectId: Type.String() }),
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

export const SendMessageInputSchema = Type.Object(SendMessageFields);
export type SendMessageInput = Type.Static<typeof SendMessageInputSchema>;

export const StartConversationInputSchema = Type.Object({
  ...SendMessageFields,
  projectId: Type.String({ minLength: 1 }),
  model: Type.Optional(ModelRefSchema),
  thinkingLevel: Type.Optional(ThinkingLevelSchema),
});
export type StartConversationInput = Type.Static<typeof StartConversationInputSchema>;

export const RetryInputSchema = Type.Object({ requestId: Type.String({ minLength: 1 }) });
export type RetryInput = Type.Static<typeof RetryInputSchema>;
