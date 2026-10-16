import type { Conversation, ConversationId, Harness } from "@earendil-works/pi-durable";
import {
  AppError,
  type ConversationSummary,
  type ModelRef,
  type OpsListener,
  type Project,
  type SendMessageInput,
} from "@pi-everywhere/protocol";
import { titleFromFirstMessage } from "../conversation-title";
import { ConversationDoc, INDEX_SEED, type IndexedConversation, ProjectIndexDoc } from "./conversation-docs";
import { BACKGROUND } from "./open";
import { watchConversation } from "./watch-conversation";

const notFound = () => new AppError("not_found", "Conversation not found.");

function conversationIdFrom(id: string): ConversationId | undefined {
  return /^[1-9]\d*$/.test(id) ? (Number(id) as ConversationId) : undefined;
}

const toSummary = (projectId: string, entry: IndexedConversation): ConversationSummary => ({
  id: String(entry.conversationId),
  projectId,
  title: entry.title,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
  archivedAt: entry.archivedAt ?? null,
  status: entry.status ?? "idle",
  lastRunEndedAt: entry.lastRunEndedAt ?? null,
});

const byMostRecentlyUpdated = (a: ConversationSummary, b: ConversationSummary) =>
  b.updatedAt - a.updatedAt || Number(b.id) - Number(a.id);

interface KnownConversation {
  readonly conversation: Conversation;
  readonly projectId: string;
}

export interface ConversationStore {
  list(projectId: string): Promise<ConversationSummary[]>;
  create(project: Project, model: ModelRef, now: number): Promise<ConversationSummary>;
  /** Returns the project id so the caller can announce the index change. */
  rename(id: string, title: string): Promise<string>;
  /** Admits the message (steering when busy), then titles an untitled conversation. Returns the project id. */
  send(id: string, input: SendMessageInput, now: number): Promise<string>;
  abort(id: string): Promise<void>;
  /** Aborts the project's busy conversations and drops them from its index. */
  removeAllOfProject(projectId: string): Promise<void>;
  watch(id: string, onOps: OpsListener): Promise<{ stop(): Promise<void> }>;
}

export function createConversationStore(harness: Harness): ConversationStore {
  async function indexOf(projectId: string): Promise<IndexedConversation[]> {
    return [...((await harness.snapshot(ProjectIndexDoc, projectId, BACKGROUND))?.conversations ?? [])];
  }

  async function known(id: string): Promise<KnownConversation> {
    const conversationId = conversationIdFrom(id);
    if (conversationId === undefined) throw notFound();
    const meta = await harness.snapshot(ConversationDoc, conversationId, BACKGROUND).catch(() => undefined);
    const conversation = meta ? await harness.conversation(conversationId, BACKGROUND) : undefined;
    if (!meta || !conversation) throw notFound();
    return { conversation, projectId: meta.projectId };
  }

  async function titleAndTouch(conversation: Conversation, projectId: string, text: string, now: number) {
    await harness.commit(async (tx) => {
      const meta = await tx.doc(ConversationDoc, conversation.id);
      const entry = (await tx.doc(ProjectIndexDoc, projectId, INDEX_SEED)).conversations.find(
        (candidate) => candidate.conversationId === Number(conversation.id),
      );
      if (meta.title === "") meta.title = titleFromFirstMessage(text);
      if (!entry) return;
      entry.title = meta.title;
      entry.updatedAt = now;
    }, BACKGROUND);
  }

  async function isKnownRequest(conversation: Conversation, requestId: string): Promise<boolean> {
    const record = await harness.commit(
      (tx) => tx.submissionByRequest(conversation.id, requestId),
      BACKGROUND,
    );
    return record !== undefined;
  }

  return {
    async list(projectId) {
      const entries = await indexOf(projectId);
      return entries.map((entry) => toSummary(projectId, entry)).sort(byMostRecentlyUpdated);
    },

    async create(project, model, now) {
      const entry = { conversationId: 0, title: "", createdAt: now, updatedAt: now };
      const conversation = await harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: { model, cwd: project.path },
          init: async (tx, conversationId) => {
            entry.conversationId = Number(conversationId);
            const meta = await tx.doc(ConversationDoc, conversationId);
            meta.projectId = project.id;
            meta.title = "";
            (await tx.doc(ProjectIndexDoc, project.id, INDEX_SEED)).conversations.push({ ...entry });
          },
        },
        BACKGROUND,
      );
      return toSummary(project.id, { ...entry, conversationId: Number(conversation.id) });
    },

    async rename(id, title) {
      const { conversation, projectId } = await known(id);
      await harness.commit(async (tx) => {
        (await tx.doc(ConversationDoc, conversation.id)).title = title;
        const entry = (await tx.doc(ProjectIndexDoc, projectId, INDEX_SEED)).conversations.find(
          (candidate) => candidate.conversationId === Number(conversation.id),
        );
        if (entry) entry.title = title;
      }, BACKGROUND);
      return projectId;
    },

    async send(id, input, now) {
      const { conversation, projectId } = await known(id);
      if (await isKnownRequest(conversation, input.requestId)) return projectId;
      await conversation.submit(
        { type: "input", content: input.text, requestId: input.requestId, whenBusy: "steer" },
        BACKGROUND,
      );
      await titleAndTouch(conversation, projectId, input.text, now);
      return projectId;
    },

    async abort(id) {
      await (await known(id)).conversation.abort(BACKGROUND);
    },

    async removeAllOfProject(projectId) {
      const entries = await indexOf(projectId);
      await Promise.all(
        entries.map(async (entry) => {
          const conversation = await harness.conversation(entry.conversationId as ConversationId, BACKGROUND);
          await conversation?.abort(BACKGROUND);
        }),
      );
      await harness.commit(async (tx) => {
        const index = await tx.doc(ProjectIndexDoc, projectId, INDEX_SEED);
        index.conversations.splice(0, index.conversations.length);
      }, BACKGROUND);
    },

    async watch(id, onOps) {
      const { conversation } = await known(id);
      return watchConversation(conversation, onOps);
    },
  };
}
