import type { Conversation } from "@earendil-works/pi-durable";
import type { ConversationWatcher, Op, OpsListener } from "@pi-everywhere/protocol";
import { watchConversation } from "./watch-conversation";

const VIEW_RETIRED: readonly Op[] = [["r", null]];

export interface WatcherRegistry {
  watch(conversation: Conversation, onOps: OpsListener): Promise<ConversationWatcher>;
  /** Delivers `[["r", null]]` to every active watcher of the conversation and stops them. */
  retireAll(conversationId: string): Promise<void>;
}

export function createWatcherRegistry(): WatcherRegistry {
  const retirers = new Map<string, Set<() => Promise<void>>>();

  return {
    async watch(conversation, onOps) {
      const id = String(conversation.id);
      let closed = false;
      const guarded: OpsListener = async (ops) => {
        if (!closed) await onOps(ops);
      };
      const watcher = await watchConversation(conversation, guarded);
      const retire = async () => {
        closed = true;
        await watcher.stop();
        await onOps(VIEW_RETIRED);
      };
      const forThisConversation = retirers.get(id) ?? new Set();
      forThisConversation.add(retire);
      retirers.set(id, forThisConversation);
      return {
        async stop() {
          closed = true;
          retirers.get(id)?.delete(retire);
          await watcher.stop();
        },
      };
    },
    async retireAll(conversationId) {
      const active = [...(retirers.get(conversationId) ?? [])];
      retirers.delete(conversationId);
      await Promise.all(
        active.map((retire) =>
          retire().catch((error) => console.error("pi-everywhere: could not retire a watcher", error)),
        ),
      );
    },
  };
}
