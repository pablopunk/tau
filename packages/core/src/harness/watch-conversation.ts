import type { JsonValue } from "@earendil-works/chord";
import type { Conversation } from "@earendil-works/pi-durable";
import type { ConversationWatcher, OpsListener } from "@tau/protocol";
import { BACKGROUND } from "./open";

/** First frame is the whole view as `[["r", view]]`, then each commit's ops. Nothing is delivered after `stop()`. */
export async function watchConversation(
  conversation: Conversation,
  onOps: OpsListener,
): Promise<ConversationWatcher> {
  const watch = await conversation.watch(BACKGROUND);
  let stopped = false;
  const forward: OpsListener = async (ops) => {
    if (!stopped) await onOps(ops);
  };
  try {
    await forward([["r", watch.value as unknown as JsonValue]]);
  } catch (error) {
    await watch.stop();
    throw error;
  }
  watch.start((_view, ops) => forward(ops));
  return {
    async stop() {
      stopped = true;
      await watch.stop();
    },
  };
}
