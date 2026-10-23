import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useOptionalLiveClient } from "@/conversation";
import { prefetchThreadData } from "@/lib/thread-prefetch";
import { useApi } from "@/nodes/node-context";

/** Hovering this long reads as intent; a pointer sweeping across the list does not. */
const HOVER_INTENT_MS = 120;

/**
 * Start loading a thread before it is opened: on press at once, on hover or focus after a short dwell.
 * The live client keeps it for a while, so the click lands on a view that is already there.
 */
export function useWarmOnIntent(conversationId: string) {
  const client = useOptionalLiveClient();
  const queryClient = useQueryClient();
  const api = useApi();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => cancel, [cancel]);
  const warmNow = useCallback(() => {
    cancel();
    if (!client) return;
    client.warm(conversationId);
    prefetchThreadData(queryClient, api, conversationId);
  }, [client, queryClient, api, conversationId, cancel]);
  const warmSoon = useCallback(() => {
    if (!client || timer.current !== undefined) return;
    timer.current = setTimeout(warmNow, HOVER_INTENT_MS);
  }, [client, warmNow]);
  return {
    onPointerEnter: warmSoon,
    onFocus: warmSoon,
    onPointerLeave: cancel,
    onBlur: cancel,
    onPointerDown: warmNow,
  };
}
