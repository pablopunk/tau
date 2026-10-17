import type {
  Conversation,
  ConversationCreateOptions,
  ConversationId,
  EntryId,
  EntryRecord,
  Harness,
} from "@earendil-works/pi-durable";
import { AppError, type ConversationSummary } from "@pi-everywhere/protocol";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "./conversation-docs";
import type { ConversationStore } from "./conversation-store";
import { forkedWorkspace } from "./forked-workspace";
import { BACKGROUND } from "./open";

export interface ForkOptions {
  /** Fork just before the entry instead of at it (rewind). */
  readonly before?: boolean;
  readonly title?: string;
}

export type ForkedListener = (fork: ConversationSummary, parentId: string) => Promise<void>;

export interface ConversationForker {
  /** The Harness the forker works on, so services that keep per-thread documents can read and write them. */
  readonly harness: Harness;
  /**
   * `parent.fork(entryId, { ownership: { kind: "ownerless" }, init })`; `init` writes the ConversationDoc and the
   * index entry (workspace shared with the source, `forkOf`, title "Fork of ...") in the same commit.
   */
  fork(conversationId: string, entryId: string, options?: ForkOptions): Promise<ConversationSummary>;
  /** The text of a user message. `not_found` for an unknown entry, `invalid_request` for any other entry. */
  messageText(conversationId: string, entryId: string): Promise<string>;
  /** The transcript entry a submission was placed as, or null while it is queued or unknown. */
  entryOfRequest(conversationId: string, requestId: string): Promise<string | null>;
  /** Runs after each fork exists. */
  onForked(listener: ForkedListener): void;
}

const notFound = () => new AppError("not_found", "Conversation or message not found.");

const idFrom = <T>(text: string): T | undefined =>
  /^[1-9]\d*$/.test(text) ? (Number(text) as T) : undefined;

type Message = { role?: string; content?: unknown };

function textOf(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .flatMap((part: { type?: string; text?: string }) => (part.type === "text" ? [part.text ?? ""] : []))
    .join("\n");
}

async function entryOf(conversation: Conversation, id: EntryId): Promise<EntryRecord> {
  const page = await conversation.entries(
    { minEntryId: id, maxEntryId: id, order: "ascending" },
    1,
    undefined,
    BACKGROUND,
  );
  const entry = page.items[0];
  if (!entry || entry.id !== id) throw notFound();
  return entry;
}

async function entryBefore(conversation: Conversation, id: EntryId): Promise<EntryRecord | undefined> {
  const page = await conversation.entries({ maxEntryId: id, order: "descending" }, 2, undefined, BACKGROUND);
  return page.items.find((entry) => entry.id !== id);
}

export function createConversationForker(
  harness: Harness,
  conversations: ConversationStore,
): ConversationForker {
  const listeners: ForkedListener[] = [];

  async function openConversation(id: string): Promise<Conversation> {
    const conversationId = idFrom<ConversationId>(id);
    const conversation =
      conversationId === undefined || !(await conversations.find(id))
        ? undefined
        : await harness.conversation(conversationId, BACKGROUND);
    if (!conversation) throw notFound();
    return conversation;
  }

  async function lookUpEntry(conversationId: string, entryId: string) {
    const conversation = await openConversation(conversationId);
    const id = idFrom<EntryId>(entryId);
    if (id === undefined) throw notFound();
    return { conversation, id, entry: await entryOf(conversation, id) };
  }

  async function forkPoint(conversation: Conversation, id: EntryId, before: boolean) {
    return before ? (await entryBefore(conversation, id))?.id : id;
  }

  /** A fork with no history at all: the message is the first entry, so there is nothing to fork from. */
  async function startEmptyLike(conversation: Conversation, options: ConversationCreateOptions) {
    const { model, cwd, thinkingLevel } = await conversation.agent(BACKGROUND);
    return harness.createConversation({ ...options, agent: { model, cwd, thinkingLevel } }, BACKGROUND);
  }

  return {
    harness,

    async fork(conversationId, entryId, options = {}) {
      const { conversation, id } = await lookUpEntry(conversationId, entryId);
      const parent = await conversations.find(conversationId);
      if (!parent) throw notFound();
      const title = options.title ?? `Fork of ${parent.title || "thread"}`;
      const now = Date.now();
      const at = await forkPoint(conversation, id, options.before ?? false);
      const createOptions: ConversationCreateOptions = {
        ownership: { kind: "ownerless" },
        init: async (tx, forkId) => {
          const meta = await tx.doc(ConversationDoc, forkId);
          meta.projectId = parent.projectId;
          meta.title = title;
          meta.titleSource = "user";
          delete meta.pendingFirstInput;
          delete meta.deletedAt;
          const index = await tx.doc(ProjectIndexDoc, parent.projectId, INDEX_SEED);
          index.conversations.push({
            conversationId: Number(forkId),
            title,
            createdAt: now,
            updatedAt: now,
            status: "idle",
            workspace: forkedWorkspace(parent.workspace),
            forkOf: { conversationId, entryId },
            ...(parent.model && { model: parent.model }),
          });
        },
      };
      const created =
        at === undefined
          ? await startEmptyLike(conversation, createOptions)
          : await conversation.fork(at, createOptions, BACKGROUND);
      const fork = await conversations.find(String(created.id));
      if (!fork) throw notFound();
      for (const listener of listeners) await listener(fork, conversationId);
      return fork;
    },

    async messageText(conversationId, entryId) {
      const { entry } = await lookUpEntry(conversationId, entryId);
      const message = entry.model?.[0] as Message | undefined;
      if (message?.role !== "user") throw new AppError("invalid_request", "This is not a user message.");
      return textOf(message);
    },

    async entryOfRequest(conversationId, requestId) {
      const id = idFrom<ConversationId>(conversationId);
      if (id === undefined) return null;
      const submission = await harness.commit((tx) => tx.submissionByRequest(id, requestId), BACKGROUND);
      return submission?.entry === undefined ? null : String(submission.entry);
    },

    onForked(listener) {
      listeners.push(listener);
    },
  };
}
