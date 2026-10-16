import { Type } from "typebox";

export const ModelRefSchema = Type.Object({ provider: Type.String(), modelId: Type.String() });
export type ModelRef = Type.Static<typeof ModelRefSchema>;

export const ModelInfoSchema = Type.Object({
  provider: Type.String(),
  modelId: Type.String(),
  name: Type.String(),
  contextWindow: Type.Number(),
  reasoning: Type.Boolean(),
});
export type ModelInfo = Type.Static<typeof ModelInfoSchema>;

export const SettingsSchema = Type.Object({ defaultModel: Type.Union([ModelRefSchema, Type.Null()]) });
export type Settings = Type.Static<typeof SettingsSchema>;

export const ProviderStatusSchema = Type.Object({
  provider: Type.String(),
  configured: Type.Boolean(),
  source: Type.Union([Type.Literal("file"), Type.Literal("env"), Type.Null()]),
  valid: Type.Union([Type.Boolean(), Type.Null()]),
});
export type ProviderStatus = Type.Static<typeof ProviderStatusSchema>;

export const ProjectSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  path: Type.String(),
  createdAt: Type.Number(),
});
export type Project = Type.Static<typeof ProjectSchema>;

export const ConversationSummarySchema = Type.Object({
  id: Type.String(),
  projectId: Type.String(),
  title: Type.String(),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
});
export type ConversationSummary = Type.Static<typeof ConversationSummarySchema>;

export const ChangeSchema = Type.Union([
  Type.Object({ resource: Type.Literal("projects") }),
  Type.Object({ resource: Type.Literal("conversations"), projectId: Type.String() }),
]);
export type Change = Type.Static<typeof ChangeSchema>;

export const SendMessageInputSchema = Type.Object({
  text: Type.String({ minLength: 1 }),
  requestId: Type.String({ minLength: 1 }),
});
export type SendMessageInput = Type.Static<typeof SendMessageInputSchema>;
