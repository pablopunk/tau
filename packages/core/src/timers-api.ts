import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import { AppError, type ConversationSummary, type Core } from "@tau/protocol";
import { readMeta } from "./harness/conversation-index";
import type { ConversationStore } from "./harness/conversation-store";
import { BACKGROUND } from "./harness/open";
import { parseEvery } from "./timers/every";
import { newTimerId } from "./timers/timer-ids";
import {
  addTimer,
  loopTimersOf,
  removeTimersWhere,
  timersOfThread,
  timersOfThreadId,
  timerWithId,
} from "./timers/timer-ops";

export const DYNAMIC_LOOP_INSTRUCTION =
  "At the end of each turn, call `schedule_wakeup` with the delay that fits (at least 5 min unless the user asked for less), or stop by not calling it.";

export interface TimersApiDeps {
  readonly harness: Harness;
  readonly conversations: ConversationStore;
  readonly now: () => number;
  readonly projectIds: () => Promise<readonly string[]>;
  readonly announce: (projectId: string, conversationId: string) => void;
}

export type TimersApi = Core["timers"] & {
  /** A deleted thread loses its timers. An archived one loses them at the next scheduler pass. */
  onConversationRemoved(conversation: ConversationSummary): Promise<void>;
};

const notFound = () => new AppError("not_found", "Conversation not found.");

export function createTimersApi(deps: TimersApiDeps): TimersApi {
  const { harness, conversations, now, announce } = deps;

  async function projectOfLiveThread(id: string): Promise<string> {
    const thread = await conversations.find(id);
    if (!thread) throw notFound();
    return thread.projectId;
  }

  const dynamicPrompt = (prompt: string) => `${prompt}\n\n${DYNAMIC_LOOP_INSTRUCTION}`;

  async function startRepeatingLoop(
    conversationId: string,
    projectId: string,
    every: string,
    prompt: string,
  ) {
    parseEvery(every);
    const id = newTimerId();
    const at = now();
    await harness.commit(async (tx) => {
      await removeTimersWhere(tx, projectId, loopTimersOf(conversationId));
      await addTimer(
        tx,
        Number(conversationId) as ConversationId,
        { id, kind: "repeat", every, prompt, reason: null, source: "loop", nextAt: at + parseEvery(every) },
        at,
      );
    }, BACKGROUND);
    announce(projectId, conversationId);
    return `loop:${id}:0`;
  }

  return {
    async list(conversationId) {
      const meta = Number.isInteger(Number(conversationId))
        ? await readMeta(harness, Number(conversationId) as ConversationId)
        : undefined;
      if (!meta || meta.deletedAt !== undefined) throw notFound();
      return harness.commit((tx) => timersOfThread(tx, Number(conversationId) as ConversationId), BACKGROUND);
    },

    async delete(id) {
      for (const projectId of await deps.projectIds()) {
        const [removed] = await harness.commit(
          (tx) => removeTimersWhere(tx, projectId, timerWithId(id)),
          BACKGROUND,
        );
        if (removed) return announce(projectId, removed.conversationId);
      }
    },

    async loop(conversationId, { every, prompt }) {
      const projectId = await projectOfLiveThread(conversationId);
      const requestId =
        every === undefined
          ? `loop:${newTimerId()}:0`
          : await startRepeatingLoop(conversationId, projectId, every, prompt);
      await conversations.send(
        conversationId,
        { text: every === undefined ? dynamicPrompt(prompt) : prompt, requestId },
        now(),
        "followUp",
      );
      announce(projectId, conversationId);
    },

    async stopLoop(conversationId) {
      const projectId = await projectOfLiveThread(conversationId);
      const removed = await harness.commit(
        (tx) => removeTimersWhere(tx, projectId, loopTimersOf(conversationId)),
        BACKGROUND,
      );
      if (removed.length > 0) announce(projectId, conversationId);
    },

    async onConversationRemoved(thread) {
      const removed = await harness.commit(
        (tx) => removeTimersWhere(tx, thread.projectId, timersOfThreadId(thread.id)),
        BACKGROUND,
      );
      if (removed.length > 0) announce(thread.projectId, thread.id);
    },
  };
}
