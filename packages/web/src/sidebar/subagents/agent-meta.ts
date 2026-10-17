import type { ConversationSummary, ModelRef } from "@pi-everywhere/protocol";

export const GENERAL_PURPOSE = "general-purpose";

export const agentTypeLabel = (agentType: string | null | undefined): string => agentType ?? GENERAL_PURPOSE;

export const isSpecialType = (agentType: string | null | undefined): agentType is string =>
  !!agentType && agentType !== GENERAL_PURPOSE;

export const agentModelLabel = (model: ModelRef | null | undefined): string | undefined => model?.modelId;

export const isRunningChild = (child: ConversationSummary | undefined): boolean =>
  child?.agentStatus === "running";
