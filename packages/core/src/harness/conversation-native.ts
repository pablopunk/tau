import type { Conversation, ConversationId, Harness, Tx } from "@earendil-works/pi-durable";
import {
  AppError,
  type ConversationStatus,
  type ConversationSummary,
  type SendMessageInput,
  type ThreadWorkspace,
} from "@tau/protocol";
import { titleFromFirstMessage } from "../conversation-title";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "./conversation-docs";
import {
  indexOf,
  isLive,
  type ProjectRef,
  readMeta,
  scanAppConversations,
  toSummary,
  updateLiveConversation,
} from "./conversation-index";
import { BACKGROUND } from "./open";
import {
  NATIVE_EXECUTOR,
  NativeCancelsDoc,
  NativeEventsDoc,
  NativeInboxDoc,
  NativeOperationDoc,
  NativeProjectionDoc,
  NativeThreadDoc,
} from "./runtime-docs";

export type NativeStartRequest = {
  readonly project: ProjectRef;
  readonly input: SendMessageInput;
  readonly workspace: ThreadWorkspace;
  readonly now: number;
};

export type NativeStartResult = { readonly summary: ConversationSummary; readonly created: boolean };

/** Thrown inside `init` to roll back a start whose `requestId` already created a thread. */
class ExistingNativeStart extends Error {
  constructor(readonly conversationId: number) {
    super("This start request already created a native conversation.");
  }
}

async function materializeRuntimeDocs(tx: Tx, conversationId: ConversationId, now: number): Promise<void> {
  const thread = await tx.doc(NativeThreadDoc, conversationId);
  thread.executor = NATIVE_EXECUTOR;
  thread.createdAt = now;
  await tx.doc(NativeInboxDoc, conversationId);
  await tx.doc(NativeProjectionDoc, conversationId);
  await tx.doc(NativeCancelsDoc, conversationId);
  await tx.doc(NativeOperationDoc, conversationId);
  await tx.doc(NativeEventsDoc, conversationId);
}

function createContainer(harness: Harness, request: NativeStartRequest): Promise<Conversation> {
  const { project, input, workspace, now } = request;
  return harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: { cwd: workspace.path },
      init: async (tx, conversationId) => {
        const index = await tx.doc(ProjectIndexDoc, project.id, INDEX_SEED);
        const existing = index.conversations.find(
          (entry) => entry.startRequestId === input.requestId && isLive(entry),
        );
        if (existing) throw new ExistingNativeStart(existing.conversationId);
        const title = titleFromFirstMessage(input.text, input.files);
        const meta = await tx.doc(ConversationDoc, conversationId);
        meta.projectId = project.id;
        meta.title = title;
        meta.titleSource = "first-message";
        meta.executor = NATIVE_EXECUTOR;
        await materializeRuntimeDocs(tx, conversationId, now);
        index.conversations.push({
          conversationId: Number(conversationId),
          title,
          createdAt: now,
          updatedAt: now,
          startRequestId: input.requestId,
          status: "idle",
          workspace,
          executor: NATIVE_EXECUTOR,
        });
      },
    },
    BACKGROUND,
  );
}

async function summaryOfConversation(
  harness: Harness,
  project: ProjectRef,
  conversationId: number,
): Promise<ConversationSummary> {
  const entry = (await indexOf(harness, project.id)).find(
    (candidate) => candidate.conversationId === conversationId && isLive(candidate),
  );
  if (!entry) throw new AppError("not_found", "Conversation not found.");
  return toSummary(project, entry);
}

/**
 * Creates a visible conversation for a native thread: a passive Pi container with the same app meta and project
 * index entry `store.start` writes, the native runtime docs, no model and no Pi input. Pi is never asked to do anything.
 */
export async function createNativeConversation(
  harness: Harness,
  request: NativeStartRequest,
): Promise<NativeStartResult> {
  try {
    const conversation = await createContainer(harness, request);
    return {
      summary: await summaryOfConversation(harness, request.project, Number(conversation.id)),
      created: true,
    };
  } catch (error) {
    if (!(error instanceof ExistingNativeStart)) throw error;
    return {
      summary: await summaryOfConversation(harness, request.project, error.conversationId),
      created: false,
    };
  }
}

export async function isNativeConversation(harness: Harness, id: string): Promise<boolean> {
  if (!/^[1-9]\d*$/.test(id)) return false;
  const meta = await readMeta(harness, Number(id) as ConversationId);
  return meta !== undefined && meta.deletedAt === undefined && meta.executor === NATIVE_EXECUTOR;
}

export type NativeThreadRef = { readonly id: string; readonly projectId: string };

export async function listNativeConversations(harness: Harness): Promise<NativeThreadRef[]> {
  return (await scanAppConversations(harness))
    .filter(({ meta }) => meta.deletedAt === undefined && meta.executor === NATIVE_EXECUTOR)
    .map(({ id, meta }) => ({ id: String(id), projectId: meta.projectId }));
}

export type NativeActivity = {
  readonly status: ConversationStatus;
  readonly at: number;
  readonly endedRun: boolean;
};

/** Mirrors the run on the sidebar entry: a starting run unarchives, an ending run does not. Applies nothing to a deleted thread. */
export async function recordNativeActivity(
  harness: Harness,
  thread: NativeThreadRef,
  activity: NativeActivity,
): Promise<boolean> {
  return updateLiveConversation(
    harness,
    Number(thread.id) as ConversationId,
    thread.projectId,
    (_meta, entry) => {
      entry.status = activity.status;
      entry.updatedAt = activity.at;
      if (activity.endedRun) entry.lastRunEndedAt = activity.at;
      else delete entry.archivedAt;
      return true;
    },
  );
}

/** A queued message unarchives the thread and moves it up the sidebar, like a Pi send does. */
export async function touchNativeConversation(
  harness: Harness,
  thread: NativeThreadRef,
  at: number,
): Promise<boolean> {
  return updateLiveConversation(
    harness,
    Number(thread.id) as ConversationId,
    thread.projectId,
    (_meta, entry) => {
      entry.updatedAt = at;
      delete entry.archivedAt;
      return true;
    },
  );
}
