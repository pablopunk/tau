import { useQueryClient } from "@tanstack/react-query";
import { type FocusEvent, useCallback, useEffect, useRef } from "react";
import { useOptionalLiveClient } from "@/conversation";
import { prefetchThreadData } from "@/lib/thread-prefetch";
import { useApi } from "@/nodes/node-context";

/** Hovering this long reads as intent; a pointer sweeping across the list does not. */
const HOVER_INTENT_MS = 120;

/**
 * Start loading a thread before it is opened: on press at once, on hover or focus after a short dwell.
 * The live client keeps it for a while, so the click lands on a view that is already there.
 */
export function useWarmOnIntent(conversationId: string, enabled = true) {
  const client = useOptionalLiveClient();
  const queryClient = useQueryClient();
  const api = useApi();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const warmed = useRef(false);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const reset = useCallback(() => {
    cancel();
    warmed.current = false;
  }, [cancel]);
  useEffect(() => reset, [reset]);
  const warmNow = useCallback(() => {
    cancel();
    if (!client || !enabled || warmed.current) return;
    warmed.current = true;
    client.warm(conversationId);
    prefetchThreadData(queryClient, api, conversationId);
  }, [client, queryClient, api, conversationId, enabled, cancel]);
  const warmSoon = useCallback(() => {
    if (!client || !enabled || warmed.current || timer.current !== undefined) return;
    timer.current = setTimeout(warmNow, HOVER_INTENT_MS);
  }, [client, enabled, warmNow]);
  const onBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) reset();
    },
    [reset],
  );
  return {
    warmNow,
    handlers: {
      onPointerEnter: warmSoon,
      onFocus: warmSoon,
      onPointerLeave: reset,
      onBlur,
      onPointerDown: warmNow,
    },
  };
}
