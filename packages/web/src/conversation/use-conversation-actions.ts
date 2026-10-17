import type { ImageInput, WhenBusy } from "@pi-everywhere/protocol";
import { useCallback } from "react";
import { api } from "@/lib/api";

export function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface ConversationActions {
  send(input: { text: string; images: ImageInput[]; whenBusy?: WhenBusy }): Promise<void>;
  stop(): Promise<void>;
  retry(requestId: string): Promise<void>;
}

export function useConversationActions(conversationId: string): ConversationActions {
  const send = useCallback(
    ({ text, images, whenBusy }: { text: string; images: ImageInput[]; whenBusy?: WhenBusy }) =>
      api.conversations.send(conversationId, {
        text,
        ...(images.length > 0 && { images }),
        ...(whenBusy && { whenBusy }),
        requestId: newRequestId(),
      }),
    [conversationId],
  );
  const stop = useCallback(() => api.conversations.abort(conversationId), [conversationId]);
  const retry = useCallback(
    (requestId: string) => api.conversations.retry(conversationId, { requestId }),
    [conversationId],
  );
  return { send, stop, retry };
}
