import type { Conversation, ConversationId, Harness } from "@earendil-works/pi-durable";
import {
  AppError,
  type ConversationSummary,
  type ModelRef,
  type Project,
  type SendMessageInput,
  type ThinkingLevel,
  type ThreadWorkspace,
} from "@tau/protocol";
import { readFromResolved, toUserInput } from "../conversation-input";
import { titleFromFirstMessage } from "../conversation-title";
import type { UploadStore } from "../upload-store";
import type { ConnectorOffering } from "./connector-offering";
import { ConversationDoc, INDEX_SEED, pendingFirstInputOf, ProjectIndexDoc } from "./conversation-docs";
import {
  indexOf,
  isLive,
  type ProjectRef,
  scanAppConversations,
  toSummary,
  updateLiveConversation,
} from "./conversation-index";
import { submitOnce } from "./conversation-submit";
import { BACKGROUND } from "./open";

export type StartRequest = {
  readonly project: Project;
  readonly model: ModelRef;
  readonly thinkingLevel: ThinkingLevel;
  readonly input: SendMessageInput;
  readonly workspace: ThreadWorkspace;
  /** Runs once the thread exists and before its first message is admitted (the "before" checkpoint). */
  readonly beforeFirstInput?: (conversationId: string) => Promise<void>;
  readonly now: number;
};

export type StartResult = { readonly summary: ConversationSummary; readonly created: boolean };

/** Thrown inside `init` to roll back a start whose `requestId` already created a thread. */
class ExistingStart extends Error {
  constructor(readonly conversationId: number) {
    super("This start request already created a conversation.");
  }
}

export interface ConversationStarter {
  start(request: StartRequest): Promise<StartResult>;
  /** The first commit of `start` alone: what a crash before admission leaves behind. */
  createPendingOnly(request: StartRequest): Promise<Conversation>;
  /** Re-submits the first message of every thread a restart cut off. Returns the affected project ids. */
  resumePendingStarts(): Promise<string[]>;
}

export function createConversationStarter(
  harness: Harness,
  projectPathOf: (projectId: string) => Promise<string>,
  offering?: Pick<ConnectorOffering, "modelToolsFor">,
  uploads?: Pick<UploadStore, "resolveRefs">,
): ConversationStarter {
  async function admitFirstInput(
    conversation: Conversation,
    project: ProjectRef,
    input: SendMessageInput,
    now: number | undefined,
  ): Promise<ConversationSummary> {
    // Revalidate staged refs at admission: a restart may have cut off the first message after expiry.
    const resolved = await uploads?.resolveRefs(input.files ?? []) ?? [];
    await submitOnce(harness, conversation, {
      type: "input",
      content: toUserInput(input, readFromResolved(resolved)),
      requestId: input.requestId,
      whenBusy: "steer",
    });
    await updateLiveConversation(harness, conversation.id, project.id, (meta, entry) => {
      delete meta.pendingFirstInput;
      delete entry.pendingStart;
      if (now !== undefined) entry.updatedAt = now;
      return true;
    });
    const entry = (await indexOf(harness, project.id)).find(
      (candidate) => candidate.conversationId === Number(conversation.id) && isLive(candidate),
    );
    if (!entry) throw new AppError("not_found", "Conversation not found.");
    return toSummary(project, entry);
  }

  async function create({
    project,
    model,
    thinkingLevel,
    input,
    workspace,
    now,
  }: StartRequest): Promise<Conversation> {
    const offered = (await offering?.modelToolsFor(model)) ?? {};
    return harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model, cwd: workspace.path, thinkingLevel, ...offered },
        init: async (tx, conversationId) => {
          const index = await tx.doc(ProjectIndexDoc, project.id, INDEX_SEED);
          const existing = index.conversations.find(
            (entry) => entry.startRequestId === input.requestId && isLive(entry),
          );
          if (existing) throw new ExistingStart(existing.conversationId);
          const title = titleFromFirstMessage(input.text, input.files);
          const meta = await tx.doc(ConversationDoc, conversationId);
          meta.projectId = project.id;
          meta.title = title;
          meta.titleSource = "first-message";
          meta.pendingFirstInput = {
            text: input.text,
            images: input.images ?? [],
            ...(input.files ? { files: input.files } : {}),
            requestId: input.requestId,
          };
          index.conversations.push({
            conversationId: Number(conversationId),
            title,
            createdAt: now,
            updatedAt: now,
            startRequestId: input.requestId,
            pendingStart: true,
            status: "running",
            model,
            workspace,
          });
        },
      },
      BACKGROUND,
    );
  }

  async function existingConversation(id: number): Promise<Conversation> {
    const conversation = await harness.conversation(id as ConversationId, BACKGROUND);
    if (!conversation) throw new AppError("not_found", "Conversation not found.");
    return conversation;
  }

  return {
    createPendingOnly: create,

    async start(request) {
      const { project, input, now } = request;
      try {
        const conversation = await create(request);
        await request.beforeFirstInput?.(String(conversation.id));
        return { summary: await admitFirstInput(conversation, project, input, now), created: true };
      } catch (error) {
        if (!(error instanceof ExistingStart)) throw error;
        const conversation = await existingConversation(error.conversationId);
        return { summary: await admitFirstInput(conversation, project, input, now), created: false };
      }
    },

    async resumePendingStarts() {
      const projectIds = new Set<string>();
      for (const { id, meta } of await scanAppConversations(harness)) {
        const pending = pendingFirstInputOf(meta);
        if (!pending || meta.deletedAt !== undefined) continue;
        try {
          const conversation = await existingConversation(Number(id));
          await admitFirstInput(
            conversation,
            { id: meta.projectId, path: await projectPathOf(meta.projectId) },
            pending,
            undefined,
          );
          projectIds.add(meta.projectId);
        } catch (error) {
          if (error instanceof AppError && error.code === "file_expired") {
            // The staged files are gone: clear the pending start instead of retrying it forever.
            await updateLiveConversation(harness, id, meta.projectId, (doc, entry) => {
              delete doc.pendingFirstInput;
              delete entry.pendingStart;
              return true;
            });
            projectIds.add(meta.projectId);
            console.error("tau: dropping a first message with expired uploads", error);
          } else {
            console.error("tau: could not resume a first message", error);
          }
        }
      }
      return [...projectIds];
    },
  };
}
