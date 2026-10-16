import {
  type Conversation,
  ConversationBusy,
  type ConversationId,
  type Harness,
} from "@earendil-works/pi-durable";
import {
  AppError,
  type ConversationSummary,
  type ConversationView,
  isRetryable,
  type ModelRef,
  type OpsListener,
  type RetryInput,
  type SendMessageInput,
} from "@pi-everywhere/protocol";
import { toUserInput } from "../conversation-input";
import { titleFromFirstMessage } from "../conversation-title";
import { RETRY_PROMPT } from "../retry-prompt";
import {
  byMostRecentlyUpdated,
  indexOf,
  isLive,
  readMeta,
  scanAppConversations,
  toSummary,
  updateLiveConversation,
} from "./conversation-index";
import {
  type ConversationStarter,
  createConversationStarter,
  type StartRequest,
  type StartResult,
} from "./conversation-start";
import { submitOnce } from "./conversation-submit";
import { createWatcherRegistry } from "./conversation-watchers";
import { isBusy } from "./live-state";
import { BACKGROUND } from "./open";

const notFound = () => new AppError("not_found", "Conversation not found.");

function conversationIdFrom(id: string): ConversationId | undefined {
  return /^[1-9]\d*$/.test(id) ? (Number(id) as ConversationId) : undefined;
}

interface KnownConversation {
  readonly conversation: Conversation;
  readonly id: ConversationId;
  readonly projectId: string;
}

export type SendResult = {
  readonly projectId: string;
  /** Set when this send gave an untitled legacy thread its provisional title: the title job should run. */
  readonly titleText?: string;
};

export interface ConversationStore extends Pick<ConversationStarter, "resumePendingStarts"> {
  /** Not deleted, archived included. */
  list(projectId: string): Promise<ConversationSummary[]>;
  start(request: StartRequest): Promise<StartResult>;
  /** `not_found` for an unknown or deleted thread. */
  modelOf(id: string): Promise<ModelRef | undefined>;
  /** Returns the project id so the caller can announce the index change. */
  rename(id: string, title: string): Promise<string>;
  /** Admits the message (steering when busy) exactly once per `requestId`, and unarchives. */
  send(id: string, input: SendMessageInput, now: number): Promise<SendResult>;
  /** One `app.retry` submission, exactly once per `requestId`. `invalid_request` unless the thread is retryable. */
  retry(id: string, input: RetryInput, now: number): Promise<string>;
  abort(id: string): Promise<void>;
  archive(id: string, archived: boolean, now: number): Promise<string>;
  /** Tombstones, aborts and retires watchers. Idempotent; returns the project id when it deleted something. */
  remove(id: string, now: number): Promise<string | undefined>;
  /** Tombstones every thread of the project. */
  removeAllOfProject(projectId: string, now?: number): Promise<void>;
  /** Aborts live runs of tombstoned threads (a crash between the tombstone and the abort). */
  abortTombstonedRuns(): Promise<void>;
  watch(id: string, onOps: OpsListener): Promise<{ stop(): Promise<void> }>;
}

async function currentView(conversation: Conversation): Promise<ConversationView> {
  const watch = await conversation.watch(BACKGROUND);
  try {
    return watch.value as unknown as ConversationView;
  } finally {
    await watch.stop();
  }
}

export function createConversationStore(harness: Harness): ConversationStore {
  const watchers = createWatcherRegistry();
  const starter = createConversationStarter(harness);

  async function known(id: string): Promise<KnownConversation> {
    const conversationId = conversationIdFrom(id);
    if (conversationId === undefined) throw notFound();
    const meta = await readMeta(harness, conversationId);
    if (!meta || meta.deletedAt !== undefined) throw notFound();
    const conversation = await harness.conversation(conversationId, BACKGROUND);
    if (!conversation) throw notFound();
    return { conversation, id: conversationId, projectId: meta.projectId };
  }

  async function requireApplied(applied: Promise<boolean>): Promise<void> {
    if (!(await applied)) throw notFound();
  }

  async function tombstone(id: ConversationId, projectId: string, now: number): Promise<boolean> {
    const applied = await updateLiveConversation(harness, id, projectId, (meta, entry) => {
      meta.deletedAt = now;
      entry.deletedAt = now;
      return true;
    });
    if (!applied) return false;
    await (await harness.conversation(id, BACKGROUND))?.abort(BACKGROUND);
    await watchers.retireAll(String(id));
    return true;
  }

  return {
    resumePendingStarts: () => starter.resumePendingStarts(),
    start: (request) => starter.start(request),

    async list(projectId) {
      const entries = await indexOf(harness, projectId);
      return entries
        .filter(isLive)
        .map((entry) => toSummary(projectId, entry))
        .sort(byMostRecentlyUpdated);
    },

    async modelOf(id) {
      const { conversation } = await known(id);
      return (await conversation.agent(BACKGROUND)).model;
    },

    async rename(id, title) {
      const { id: conversationId, projectId } = await known(id);
      await requireApplied(
        updateLiveConversation(harness, conversationId, projectId, (meta, entry) => {
          meta.title = title;
          meta.titleSource = "user";
          entry.title = title;
          return true;
        }),
      );
      return projectId;
    },

    async send(id, input, now) {
      const { conversation, id: conversationId, projectId } = await known(id);
      const admitted = await submitOnce(harness, conversation, {
        type: "input",
        content: toUserInput(input),
        requestId: input.requestId,
        whenBusy: "steer",
      });
      if (!admitted) return { projectId };
      let provisionalFor: string | undefined;
      await updateLiveConversation(harness, conversationId, projectId, (meta, entry) => {
        if (meta.title === "") {
          meta.title = titleFromFirstMessage(input.text);
          provisionalFor = input.text.trim() === "" ? undefined : input.text;
        }
        entry.title = meta.title;
        entry.updatedAt = now;
        delete entry.archivedAt;
        return true;
      });
      return { projectId, titleText: provisionalFor };
    },

    async retry(id, input, now) {
      const { conversation, id: conversationId, projectId } = await known(id);
      const view = await currentView(conversation);
      const alreadyAdmitted = await harness.commit(
        (tx) => tx.submissionByRequest(conversationId, input.requestId),
        BACKGROUND,
      );
      if (alreadyAdmitted) return projectId;
      if (!isRetryable(view)) throw new AppError("invalid_request", "There is nothing to retry.");
      try {
        await submitOnce(harness, conversation, {
          type: "input",
          content: RETRY_PROMPT,
          entry: { kind: "app.retry" },
          requestId: input.requestId,
          whenBusy: "reject",
        });
      } catch (error) {
        if (error instanceof ConversationBusy) throw new AppError("invalid_request", "The thread is busy.");
        throw error;
      }
      await updateLiveConversation(harness, conversationId, projectId, (_meta, entry) => {
        entry.updatedAt = now;
        delete entry.archivedAt;
        return true;
      });
      return projectId;
    },

    async abort(id) {
      await (await known(id)).conversation.abort(BACKGROUND);
    },

    async archive(id, archived, now) {
      const { id: conversationId, projectId } = await known(id);
      await requireApplied(
        updateLiveConversation(harness, conversationId, projectId, (_meta, entry) => {
          if (archived) entry.archivedAt = now;
          else delete entry.archivedAt;
          return true;
        }),
      );
      return projectId;
    },

    async remove(id, now) {
      const conversationId = conversationIdFrom(id);
      const meta = conversationId === undefined ? undefined : await readMeta(harness, conversationId);
      if (conversationId === undefined || !meta) throw notFound();
      if (meta.deletedAt !== undefined) return undefined;
      return (await tombstone(conversationId, meta.projectId, now)) ? meta.projectId : undefined;
    },

    async removeAllOfProject(projectId, now = Date.now()) {
      const entries = (await indexOf(harness, projectId)).filter(isLive);
      await Promise.all(
        entries.map((entry) => tombstone(entry.conversationId as ConversationId, projectId, now)),
      );
    },

    async abortTombstonedRuns() {
      for (const { id, meta } of await scanAppConversations(harness)) {
        if (meta.deletedAt === undefined || !(await isBusy(harness, id))) continue;
        await (await harness.conversation(id, BACKGROUND))?.abort(BACKGROUND);
      }
    },

    async watch(id, onOps) {
      const { conversation } = await known(id);
      return watchers.watch(conversation, onOps);
    },
  };
}
