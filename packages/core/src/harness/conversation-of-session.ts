import type { Harness } from "@earendil-works/pi-durable";
import { scanAppConversations } from "./conversation-index";
import { providerSessionOf } from "./provider-session";

export type ConversationOfSession = (piSessionId: string) => Promise<string | undefined>;

/** Maps the id Pi hands to `streamSimple` back to the thread id. Looks threads up on first use, then remembers. */
export function createConversationOfSession(harness: Harness): ConversationOfSession {
  const known = new Map<string, string>();
  return async (piSessionId) => {
    const remembered = known.get(piSessionId);
    if (remembered) return remembered;
    for (const { id, meta } of await scanAppConversations(harness)) {
      if (meta.deletedAt !== undefined) continue;
      const sessionId = await providerSessionOf(harness, String(id));
      if (sessionId) known.set(sessionId, String(id));
    }
    return known.get(piSessionId);
  };
}
