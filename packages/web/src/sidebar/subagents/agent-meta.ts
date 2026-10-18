import type { AgentStatus, ConversationSummary } from "@tau/protocol";
import type { ToolStatus } from "@/conversation/model/tool-state";

export const GENERAL_PURPOSE = "general-purpose";

export const agentTypeLabel = (agentType: string | null | undefined): string => agentType ?? GENERAL_PURPOSE;

export const isSpecialType = (agentType: string | null | undefined): agentType is string =>
  !!agentType && agentType !== GENERAL_PURPOSE;

export const isRunningChild = (child: ConversationSummary | undefined): boolean =>
  child?.status === "running" || child?.agentStatus === "running";

export const modelWithLevel = (model: string | undefined, level: string | null | undefined) =>
  model && level ? `${model} · ${level}` : model;

const CARD_STATUS_OF_AGENT: Record<AgentStatus, ToolStatus> = {
  running: "running",
  done: "done",
  failed: "error",
  stopped: "interrupted",
};

export const cardStatusOf = (child: ConversationSummary | undefined, fallback: ToolStatus): ToolStatus =>
  child?.agentStatus ? CARD_STATUS_OF_AGENT[child.agentStatus] : fallback;
