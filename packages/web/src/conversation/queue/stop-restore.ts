import type { QueuedMessage } from "@tau/protocol";
import type { Api } from "@/lib/api";
import { scopeTarget } from "@/lib/machine-keys";
import { restoreQueuedToComposer } from "../composer/restore";

/**
 * Stops the run and puts the withdrawn queued messages back in the prompt
 * box. `Conversation.abort()` withdraws queued inputs, so without this the
 * messages typed while busy would vanish on Stop.
 */
export async function stopAndRestore(
  api: Api,
  conversationId: string,
  machineId: string | undefined,
  queued: readonly QueuedMessage[],
): Promise<void> {
  const snapshot = [...queued];
  await api.conversations.abort(conversationId);
  if (snapshot.length > 0) restoreQueuedToComposer(scopeTarget(conversationId, machineId), snapshot);
}
