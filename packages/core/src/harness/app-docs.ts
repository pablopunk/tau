import { defineDoc, defineDocFamily } from "@earendil-works/pi-durable";

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
};

export type IndexedConversation = {
  conversationId: number;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export const ProjectsDoc = defineDoc<{ projects: ProjectRecord[] }>({
  kind: "app.projects",
  version: 1,
  scope: "session",
  initial: () => ({ projects: [] }),
});

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
