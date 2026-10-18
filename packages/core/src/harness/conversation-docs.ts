import { defineDoc, defineDocFamily } from "@earendil-works/pi-durable";
import type { AgentStatus, ConversationStatus, ImageInput, ModelRef, ThreadWorkspace } from "@tau/protocol";

export type IndexedConversation = {
  conversationId: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  startRequestId?: string;
  pendingStart?: boolean;
  archivedAt?: number;
  deletedAt?: number;
  status?: ConversationStatus;
  lastRunEndedAt?: number;
  model?: ModelRef;
  workspace?: ThreadWorkspace;
  forkOf?: { conversationId: string; entryId: string };
  parentId?: string;
  agentType?: string;
  agentModel?: ModelRef;
  agentStatus?: AgentStatus;
  background?: boolean;
  unmergedWarning?: string;
};

export type TitleSource = "first-message" | "generated" | "user";

export type PendingFirstInput = { text: string; images: ImageInput[]; requestId: string };

export type ConversationMeta = {
  projectId: string;
  title: string;
  titleSource: TitleSource;
  pendingFirstInput?: PendingFirstInput;
  deletedAt?: number;
};

/** Keyed by project id: `scanConversations` cannot filter by project and also returns subagent children. */
export const ProjectIndexDoc = defineDocFamily<{ conversations: IndexedConversation[] }, null>({
  kind: "app.project-index",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ conversations: [] }),
});

export const ConversationDoc = defineDoc<ConversationMeta>({
  kind: "app.conversation",
  version: 2,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ projectId: "", title: "", titleSource: "first-message" }),
  migrate: (value, fromVersion) => {
    if (fromVersion >= 2) return value as ConversationMeta;
    const titled = typeof value.title === "string" && value.title !== "";
    return { ...value, titleSource: titled ? "user" : "first-message" } as ConversationMeta;
  },
});

export const INDEX_SEED = null;
