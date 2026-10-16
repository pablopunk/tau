import type { Conversation, ConversationId, Harness } from "@earendil-works/pi-durable";
import {
  AppError,
  type ConversationSummary,
  type ModelRef,
  type Project,
  type SendMessageInput,
  type ThinkingLevel,
} from "@pi-everywhere/protocol";
import { toUserInput } from "../conversation-input";
import { titleFromFirstMessage } from "../conversation-title";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "./conversation-docs";
import {
  indexOf,
  isLive,
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
  /** Re-submits the first message of every thread a restart cut off. Returns the affected project ids. */
  resumePendingStarts(): Promise<string[]>;
}

export function createConversationStarter(harness: Harness): ConversationStarter {
  async function admitFirstInput(
    conversation: Conversation,
    projectId: string,
    input: SendMessageInput,
    now: number | undefined,
  ): Promise<ConversationSummary> {
    await submitOnce(harness, conversation, {
      type: "input",
      content: toUserInput(input),
      requestId: input.requestId,
      whenBusy: "steer",
    });
    await updateLiveConversation(harness, conversation.id, projectId, (meta, entry) => {
      delete meta.pendingFirstInput;
      delete entry.pendingStart;
      if (now !== undefined) entry.updatedAt = now;
      return true;
    });
    const entry = (await indexOf(harness, projectId)).find(
      (candidate) => candidate.conversationId === Number(conversation.id) && isLive(candidate),
    );
    if (!entry) throw new AppError("not_found", "Conversation not found.");
    return toSummary(projectId, entry);
  }

  async function create({ project, model, thinkingLevel, input, now }: StartRequest): Promise<Conversation> {
    return harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model, cwd: project.path, thinkingLevel },
        init: async (tx, conversationId) => {
          const index = await tx.doc(ProjectIndexDoc, project.id, INDEX_SEED);
          const existing = index.conversations.find(
            (entry) => entry.startRequestId === input.requestId && isLive(entry),
          );
          if (existing) throw new ExistingStart(existing.conversationId);
          const title = titleFromFirstMessage(input.text);
          const meta = await tx.doc(ConversationDoc, conversationId);
          meta.projectId = project.id;
          meta.title = title;
          meta.titleSource = "first-message";
          meta.pendingFirstInput = {
            text: input.text,
            images: input.images ?? [],
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
    async start(request) {
      const { project, input, now } = request;
      try {
        const conversation = await create(request);
        return { summary: await admitFirstInput(conversation, project.id, input, now), created: true };
      } catch (error) {
        if (!(error instanceof ExistingStart)) throw error;
        const conversation = await existingConversation(error.conversationId);
        return { summary: await admitFirstInput(conversation, project.id, input, now), created: false };
      }
    },

    async resumePendingStarts() {
      const projectIds = new Set<string>();
      for (const { id, meta } of await scanAppConversations(harness)) {
        if (!meta.pendingFirstInput || meta.deletedAt !== undefined) continue;
        try {
          const conversation = await existingConversation(Number(id));
          await admitFirstInput(conversation, meta.projectId, meta.pendingFirstInput, undefined);
          projectIds.add(meta.projectId);
        } catch (error) {
          console.error("pi-everywhere: could not resume a first message", error);
        }
      }
      return [...projectIds];
    },
  };
}
