import type { FileRef, ImageInput, SendReceipt, WhenBusy } from "@tau/protocol";
import { useCallback } from "react";
import { useApi } from "@/nodes/node-context";

export function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface ConversationActions {
  send(input: {
    text: string;
    images: ImageInput[];
    files: FileRef[];
    whenBusy?: WhenBusy;
  }): Promise<SendReceipt>;
  stop(): Promise<void>;
  retry(requestId: string): Promise<SendReceipt>;
}

export function useConversationActions(conversationId: string): ConversationActions {
  const api = useApi();
  const send = useCallback(
    ({
      text,
      images,
      files,
      whenBusy,
    }: {
      text: string;
      images: ImageInput[];
      files: FileRef[];
      whenBusy?: WhenBusy;
    }) =>
      api.conversations.send(conversationId, {
        text,
        ...(images.length > 0 && { images }),
        ...(files.length > 0 && { files }),
        ...(whenBusy && { whenBusy }),
        requestId: newRequestId(),
      }),
    [api, conversationId],
  );
  const stop = useCallback(async () => {
    await api.conversations.abort(conversationId);
  }, [api, conversationId]);
  const retry = useCallback(
    (requestId: string) => api.conversations.retry(conversationId, { requestId }),
    [api, conversationId],
  );
  return { send, stop, retry };
}
