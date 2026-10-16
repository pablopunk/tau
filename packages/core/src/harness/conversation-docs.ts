import { defineDoc, defineDocFamily } from "@earendil-works/pi-durable";
import type { ConversationStatus } from "@pi-everywhere/protocol";

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
};

/** Keyed by project id: `scanConversations` cannot filter by project and also returns subagent children. */
export const ProjectIndexDoc = defineDocFamily<{ conversations: IndexedConversation[] }, null>({
  kind: "app.project-index",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ conversations: [] }),
});

export const ConversationDoc = defineDoc<{ projectId: string; title: string }>({
  kind: "app.conversation",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ projectId: "", title: "" }),
});

export const INDEX_SEED = null;
