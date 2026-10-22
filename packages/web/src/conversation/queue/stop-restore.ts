import type { QueuedMessage } from "@tau/protocol";
import type { Api } from "@/lib/api";
import { scopeTarget } from "@/lib/node-keys";
import { markConfirm, markLiveReflect } from "@/lib/timings";
import { restoreSnapshotsToComposer } from "../composer/restore";
import { isUserItem, queueRpcOf, type UserItemSnapshot } from "./queue-contract";

/**
 * Stops the run and puts the withdrawn queued user messages back in the prompt
 * box. `Conversation.abort()` withdraws queued inputs and returns the
 * snapshotted user items (text plus FileRefs resolved through the requestId
 * sidecar), so the composer restores from the server response post-success —
 * never from the client draft alone (which lacks refs and races the
 * withdraw). Notification items survive abort server-side and are never
 * restored to the draft.
 */
export async function stopAndRestore(
  api: Api,
  conversationId: string,
  nodeId: string | undefined,
  queued: readonly QueuedMessage[],
  timingToken?: string,
): Promise<void> {
  const result = await queueRpcOf(api.conversations).abort(conversationId);
  // Pre-contract nodes resolve `void`: fall back to the client snapshot,
  // user items only — never notification text (F6).
  const restored: readonly UserItemSnapshot[] =
    result?.restored ?? queued.filter(isUserItem).map((item) => ({ text: item.text, files: [] }));
  if (timingToken !== undefined) {
    markConfirm(timingToken, {}, "stop");
    if (restored.length > 0) markLiveReflect("queue-stop", {});
  }
  restoreSnapshotsToComposer(scopeTarget(conversationId, nodeId), restored);
}
