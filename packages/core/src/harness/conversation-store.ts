import {
  type Conversation,
  ConversationBusy,
  type ConversationId,
  type Harness,
} from "@earendil-works/pi-durable";
import {
  type AbortResult,
  AppError,
  type CancelQueuedResult,
  type ConversationSummary,
  type ConversationView,
  isRetryable,
  type ModelRef,
  type OpsListener,
  type RetryInput,
  type SendMessageInput,
  type SendNowResult,
  type SetQueuedModeResult,
  type ThinkingLevel,
  type ThreadWorkspace,
  type WhenBusy,
} from "@tau/protocol";
import { stripBangPrefix } from "../bang-command";
import { readFromResolved, toUserInput } from "../conversation-input";
import { titleFromFirstMessage } from "../conversation-title";
import { RETRY_PROMPT } from "../retry-prompt";
import type { UploadStore } from "../upload-store";
import type { ConnectorOffering } from "./connector-offering";
import { compactConversation } from "./conversation-compact";
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
import {
  type AdmissionReceipt,
  abortAndRestore,
  cancelQueued,
  entryOfSubmission,
  isNotificationItem,
  isUserItem,
  mintServerRequestId,
  type QueuedSnapshot,
  rememberUserItem,
  setQueuedMode,
  snapshotQueued,
  snapshotUserItem,
  submitOnce,
  submitUnlocked,
  waitForRunStart,
  withAdmissionGate,
} from "./conversation-submit";
import { createWatcherRegistry } from "./conversation-watchers";
import { isBusy } from "./live-state";
import { BACKGROUND } from "./open";

const notFound = () => new AppError("not_found", "Conversation not found.");
const notFoundError = (): never => {
  throw notFound();
};

function conversationIdFrom(id: string): ConversationId | undefined {
  return /^[1-9]\d*$/.test(id) ? (Number(id) as ConversationId) : undefined;
}

interface KnownConversation {
  readonly conversation: Conversation;
  readonly id: ConversationId;
  readonly projectId: string;
}

export type AgentSettings = { readonly model: ModelRef; readonly thinkingLevel: ThinkingLevel };

export type RetryResult = {
  readonly projectId: string;
  readonly submissionId: number;
  readonly entryId?: number;
};

export type SendResult = {
  readonly projectId: string;
  /** Set when this send gave an untitled legacy thread its provisional title: the title job should run. */
  readonly titleText?: string;
  /** False when another send with the same `requestId` won: nothing was admitted. */
  readonly admitted: boolean;
  readonly submissionId: number;
  readonly entryId?: number;
};

export interface SendNowHooks {
  /**
   * Test seam: runs while the gate is held, between the snapshot and the
   * abort. Fire-and-forget only — awaiting an admission here deadlocks on
   * the held gate. Lets a test race a notification into the steal window.
   */
  readonly afterSnapshot?: () => void;
  /** Test seam: fails the chosen admission after the abort to exercise the durable rollback. */
  readonly failChosenAdmit?: boolean;
}

export type SendNowResultWithProject = SendNowResult & { readonly projectId: string };

export interface ConversationStore
  extends Pick<ConversationStarter, "resumePendingStarts" | "createPendingOnly"> {
  /** Not deleted, archived included. */
  list(projectId: string): Promise<ConversationSummary[]>;
  /** Undefined for an unknown or deleted thread. */
  find(id: string): Promise<ConversationSummary | undefined>;
  /** Stores the workspace in the index entry and points the agent's cwd at `workspace.path`. */
  setWorkspace(id: string, workspace: ThreadWorkspace): Promise<ConversationSummary>;
  /**
   * Withdraws one queued user message, returning its snapshot for composer
   * restore. `{ cancelled: false }` once it was delivered. Rejects
   * `not_found` for unknown or foreign items, `invalid_request` for
   * notification items.
   */
  cancelQueued(id: string, itemId: string): Promise<CancelQueuedResult>;
  /**
   * Switches one queued user item between steer and followUp in place: the id (and inbox
   * position) is preserved. `{ switched: false }` once it was delivered. Rejects `not_found`
   * for unknown or foreign items, `invalid_request` for notification items.
   */
  setQueuedMode(id: string, itemId: string, mode: WhenBusy): Promise<SetQueuedModeResult>;
  /**
   * Atomically delivers one queued user item now: snapshots the queued user
   * items, aborts, then re-admits the chosen item ahead of every other
   * surviving item. The other user items return for composer restoration.
   */
  sendNow(id: string, itemId: string, hooks?: SendNowHooks): Promise<SendNowResultWithProject>;
  start(request: StartRequest): Promise<StartResult>;
  /** `not_found` for an unknown or deleted thread. */
  modelOf(id: string): Promise<ModelRef | undefined>;
  /** `not_found` for an unknown or deleted thread. */
  agentOf(id: string): Promise<AgentSettings>;
  /** Applies from the next model request, also while busy. */
  configure(id: string, settings: AgentSettings): Promise<void>;
  /** Returns the project id so the caller can announce the index change. */
  rename(id: string, title: string): Promise<string>;
  /** Admits the message (steering when busy) exactly once per `requestId`, and unarchives. */
  send(id: string, input: SendMessageInput, now: number, whenBusy?: WhenBusy): Promise<SendResult>;
  /** One `app.retry` submission, exactly once per `requestId`. `invalid_request` unless the thread is retryable. */
  retry(id: string, input: RetryInput, now: number): Promise<RetryResult>;
  abort(id: string): Promise<AbortResult>;
  /** Resolves when the compaction ends. `not_found`; `nothing_to_compact`; `internal` with pi's message on failure. */
  compact(id: string, instructions: string | undefined): Promise<void>;
  archive(id: string, archived: boolean, now: number): Promise<string>;
  /** Caches the cleanup pass verdict on the index entry; true when it changed. */
  setUnmergedWarning(id: string, warning: string | null): Promise<boolean>;
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

export interface StoreHooks {
  readonly offering?: Pick<ConnectorOffering, "modelToolsFor">;
  /** Stop: runs before a thread aborts, so a pending approval is denied first. */
  readonly beforeAbort?: (id: string) => void;
  /** Staged file refs resolve through this; without it sends carry no `files`. */
  readonly uploads?: Pick<UploadStore, "resolveRefs">;
}

export function createConversationStore(
  harness: Harness,
  projectPathOf: (projectId: string) => Promise<string>,
  hooks: StoreHooks = {},
): ConversationStore {
  const { offering } = hooks;
  const watchers = createWatcherRegistry();
  const starter = createConversationStarter(harness, projectPathOf, offering, hooks.uploads);

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
    createPendingOnly: (request) => starter.createPendingOnly(request),
    start: (request) => starter.start(request),

    async list(projectId) {
      const project = { id: projectId, path: await projectPathOf(projectId) };
      const entries = await indexOf(harness, projectId);
      return entries
        .filter(isLive)
        .map((entry) => toSummary(project, entry))
        .sort(byMostRecentlyUpdated);
    },

    async find(id) {
      const conversationId = conversationIdFrom(id);
      const meta = conversationId === undefined ? undefined : await readMeta(harness, conversationId);
      if (!meta || meta.deletedAt !== undefined) return undefined;
      const project = { id: meta.projectId, path: await projectPathOf(meta.projectId) };
      const entry = (await indexOf(harness, meta.projectId)).find(
        (candidate) => candidate.conversationId === conversationId && isLive(candidate),
      );
      return entry ? toSummary(project, entry) : undefined;
    },

    async setWorkspace(id, workspace) {
      const { conversation, id: conversationId, projectId } = await known(id);
      await conversation.configure({ cwd: workspace.path }, BACKGROUND);
      await requireApplied(
        updateLiveConversation(harness, conversationId, projectId, (_meta, entry) => {
          entry.workspace = workspace;
          return true;
        }),
      );
      return (await this.find(id)) ?? notFoundError();
    },

    async cancelQueued(id, itemId) {
      const { conversation, id: conversationId } = await known(id);
      return cancelQueued(harness, conversation, String(conversationId), itemId);
    },

    async setQueuedMode(id, itemId, mode) {
      const { conversation } = await known(id);
      return setQueuedMode(harness, conversation, itemId, mode);
    },

    async sendNow(id, itemId, hooks) {
      const { conversation, id: conversationId, projectId } = await known(id);
      const key = String(conversationId);
      return withAdmissionGate(key, async () => {
        // The snapshot must precede the abort: submission records keep no content.
        const queued = await snapshotQueued(harness, conversationId);
        const chosen = queued.find((item) => String(item.id) === itemId);
        if (!chosen) throw notFound();
        if (!isUserItem(chosen)) {
          throw new AppError("invalid_request", "Only user messages can be sent now.");
        }
        hooks?.afterSnapshot?.();
        await conversation.abort(BACKGROUND);
        const readmitNotice = async (
          item: QueuedSnapshot & { entry: NonNullable<QueuedSnapshot["entry"]> },
        ) => {
          const requestId = mintServerRequestId("reattempt", key, item.id);
          await submitUnlocked(harness, conversation, {
            type: "write",
            entry: {
              kind: item.entry.kind,
              ...(item.entry.data !== undefined && { data: item.entry.data as never }),
              model: [{ role: "user", content: item.content } as never],
            },
            requestId,
          });
        };
        const readmitUser = async (item: QueuedSnapshot, label: string) => {
          const requestId = mintServerRequestId(label, key, item.id);
          const receipt = await submitUnlocked(harness, conversation, {
            type: "input",
            content: item.content,
            ...(item.entry === undefined ? {} : { entry: item.entry }),
            requestId,
            whenBusy: item.mode === "write" ? "followUp" : item.mode,
          });
          // Carry the refs forward so a later cancel of the re-admitted item still restores them.
          rememberUserItem(requestId, receipt.submissionId, snapshotUserItem(item));
          return receipt;
        };
        let receipt: AdmissionReceipt;
        try {
          if (hooks?.failChosenAdmit === true) throw new AppError("internal", "sendNow admit failed");
          receipt = await readmitUser(chosen, "sendnow");
        } catch (error) {
          // Durable rollback: everything withdrawn returns under fresh ids — never draft, never lost.
          const users = [chosen, ...queued.filter((item) => item.id !== chosen.id && isUserItem(item))];
          for (const item of users) {
            try {
              await readmitUser(item, "sendnow-rollback");
            } catch {
              // Best effort: the original failure is what the caller must see.
            }
          }
          for (const item of queued) {
            if (isNotificationItem(item)) await readmitNotice(item);
          }
          await waitForRunStart(harness, conversationId);
          throw error;
        }
        // Chosen first, so user content always lands ahead of re-admitted notifications.
        for (const item of queued) {
          if (isNotificationItem(item)) await readmitNotice(item);
        }
        const restored = queued
          .filter((item) => item.id !== chosen.id && isUserItem(item))
          .map(snapshotUserItem);
        // The gate stays held until the chosen run starts: only then can a
        // racing notification no longer steal the idle slot (F4).
        await waitForRunStart(harness, conversationId);
        await updateLiveConversation(harness, conversationId, projectId, (_meta, entry) => {
          entry.updatedAt = Date.now();
          delete entry.archivedAt;
          return true;
        });
        return {
          submissionId: receipt.submissionId,
          ...(receipt.entryId === undefined ? {} : { entryId: receipt.entryId }),
          restored,
          projectId,
        };
      });
    },

    async modelOf(id) {
      const { conversation } = await known(id);
      return (await conversation.agent(BACKGROUND)).model;
    },

    async agentOf(id) {
      const { conversation } = await known(id);
      const { model, thinkingLevel } = await conversation.agent(BACKGROUND);
      if (!model) throw new AppError("invalid_request", "This thread has no model.");
      return {
        model: { provider: model.provider, modelId: model.modelId },
        thinkingLevel: thinkingLevel ?? "off",
      };
    },

    async configure(id, { model, thinkingLevel }) {
      const { conversation, id: conversationId, projectId } = await known(id);
      const offered = (await offering?.modelToolsFor(model)) ?? {};
      await conversation.configure({ model, thinkingLevel, ...offered }, BACKGROUND);
      await updateLiveConversation(harness, conversationId, projectId, (_meta, entry) => {
        entry.model = { provider: model.provider, modelId: model.modelId };
        return true;
      });
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

    async send(id, input, now, whenBusy = "steer") {
      const { conversation, id: conversationId, projectId } = await known(id);
      const duplicate = await harness.commit(
        (tx) => tx.submissionByRequest(conversationId, input.requestId),
        BACKGROUND,
      );
      if (duplicate)
        return {
          projectId,
          admitted: false,
          submissionId: duplicate.id,
          entryId: entryOfSubmission(duplicate),
        };
      // Revalidate staged refs before re-admitting: expiry fails here, before the run.
      const resolved = (await hooks.uploads?.resolveRefs(input.files ?? [])) ?? [];
      const receipt = await submitOnce(harness, conversation, {
        type: "input",
        content: toUserInput(input, readFromResolved(resolved)),
        requestId: input.requestId,
        whenBusy,
      });
      if (receipt.admitted)
        rememberUserItem(input.requestId, receipt.submissionId, {
          text: input.text,
          files: [...(input.files ?? [])],
        });
      if (!receipt.admitted) return { projectId, ...receipt };
      let provisionalFor: string | undefined;
      // A bang command titles from `ls`, but the stored entry keeps its verbatim `! ls` text.
      const titleSource = stripBangPrefix(input.text);
      await updateLiveConversation(harness, conversationId, projectId, (meta, entry) => {
        if (meta.title === "") {
          meta.title = titleFromFirstMessage(titleSource, input.files);
          provisionalFor = titleSource.trim() === "" ? undefined : titleSource;
        }
        entry.title = meta.title;
        entry.updatedAt = now;
        delete entry.archivedAt;
        return true;
      });
      return { projectId, titleText: provisionalFor, ...receipt };
    },

    async retry(id, input, now) {
      const { conversation, id: conversationId, projectId } = await known(id);
      const view = await currentView(conversation);
      const alreadyAdmitted = await harness.commit(
        (tx) => tx.submissionByRequest(conversationId, input.requestId),
        BACKGROUND,
      );
      if (alreadyAdmitted)
        return {
          projectId,
          submissionId: alreadyAdmitted.id,
          entryId: entryOfSubmission(alreadyAdmitted),
        };
      if (!isRetryable(view)) throw new AppError("invalid_request", "There is nothing to retry.");
      try {
        const receipt = await submitOnce(harness, conversation, {
          type: "input",
          content: RETRY_PROMPT,
          entry: { kind: "app.retry" },
          requestId: input.requestId,
          whenBusy: "reject",
        });
        await updateLiveConversation(harness, conversationId, projectId, (_meta, entry) => {
          entry.updatedAt = now;
          delete entry.archivedAt;
          return true;
        });
        return { projectId, submissionId: receipt.submissionId, entryId: receipt.entryId };
      } catch (error) {
        if (error instanceof ConversationBusy) throw new AppError("invalid_request", "The thread is busy.");
        throw error;
      }
    },

    async abort(id) {
      const { conversation, id: conversationId } = await known(id);
      hooks.beforeAbort?.(id);
      return abortAndRestore(harness, conversation, String(conversationId));
    },

    async compact(id, instructions) {
      const { conversation } = await known(id);
      await compactConversation(harness, conversation, instructions);
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

    async setUnmergedWarning(id, warning) {
      const { id: conversationId, projectId } = await known(id);
      let changed = false;
      await updateLiveConversation(harness, conversationId, projectId, (_meta, entry) => {
        if ((entry.unmergedWarning ?? null) === warning) return false;
        if (warning === null) delete entry.unmergedWarning;
        else entry.unmergedWarning = warning;
        changed = true;
        return true;
      });
      return changed;
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
