import type { ImageInput } from "@pi-everywhere/protocol";
import { useCallback } from "react";
import { api } from "@/lib/api";

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface ConversationActions {
  send(input: { text: string; images: ImageInput[] }): Promise<void>;
  stop(): Promise<void>;
}

export function useConversationActions(conversationId: string): ConversationActions {
  const send = useCallback(
    ({ text, images }: { text: string; images: ImageInput[] }) =>
      api.conversations.send(conversationId, {
        text,
        ...(images.length > 0 && { images }),
        requestId: newRequestId(),
      }),
    [conversationId],
  );
  const stop = useCallback(() => api.conversations.abort(conversationId), [conversationId]);
  return { send, stop };
}
