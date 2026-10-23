import type { FileRef, ImageInput, SendReceipt, WhenBusy } from "@tau/protocol";
import { useCallback } from "react";
import { errorMessage } from "@/lib/error-message";
import { useApi } from "@/nodes/node-context";
import {
  attachReceipt,
  failOptimistic,
  hasReceipt,
  noteOptimistic,
  optimisticKey,
  resolvePending,
  type SentReceipt,
} from "./queue/pending-sends";

export function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Shows the message in the transcript now and settles it when the request
 * does: the receipt attaches the ids live state reconciles on, a failure
 * turns the same bubble into a failed one with retry. A node that answers
 * with no receipt has nothing to reconcile on: live sync covers it.
 */
export function sendOptimistically(
  conversationId: string,
  requestId: string,
  message: { text: string; images: ImageInput[]; files: FileRef[]; whenBusy?: WhenBusy },
  request: Promise<unknown>,
): Promise<SentReceipt> {
  noteOptimistic(conversationId, requestId, message);
  return request.then(
    (receipt) => {
      if (hasReceipt(receipt)) attachReceipt(conversationId, requestId, receipt);
      else resolvePending(conversationId, optimisticKey(requestId));
      return { ...(receipt as object), requestId } as SentReceipt;
    },
    (failure: unknown) => {
      failOptimistic(conversationId, requestId, errorMessage(failure));
      throw failure;
    },
  );
}

export interface ConversationActions {
  send(input: {
    text: string;
    images: ImageInput[];
    files: FileRef[];
    whenBusy?: WhenBusy;
  }): Promise<SentReceipt>;
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
    }) => {
      const requestId = newRequestId();
      return sendOptimistically(
        conversationId,
        requestId,
        { text, images, files, ...(whenBusy && { whenBusy }) },
        api.conversations.send(conversationId, {
          text,
          ...(images.length > 0 && { images }),
          ...(files.length > 0 && { files }),
          ...(whenBusy && { whenBusy }),
          requestId,
        }),
      );
    },
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
