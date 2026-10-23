import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { useOptionalLiveClient } from "@/conversation";
import { useHotkey } from "@/lib/hotkeys";
import { newThreadPath } from "@/lib/paths";
import { prefetchThreadData } from "@/lib/thread-prefetch";
import { useApi } from "@/nodes/node-context";
import { useAdjacentThread } from "./adjacent-thread";

export function GlobalShortcuts() {
  const navigate = useNavigate();
  const { projectId, nodeId } = useOpenConversation();
  const { go, neighbors } = useAdjacentThread();
  // The keys step to the next or previous thread: have both ready before they are pressed. Only this node's
  // threads: a linked node has its own live client, which this one cannot warm.
  const live = useOptionalLiveClient();
  const queryClient = useQueryClient();
  const api = useApi();
  const warmIds = [...new Set(neighbors.flatMap((thread) => (thread.nodeId === undefined ? thread.id : [])))];
  const warmKey = warmIds.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `warmKey` is the content of `warmIds`
  useEffect(() => {
    if (!live) return;
    for (const id of warmIds) {
      live.warm(id);
      prefetchThreadData(queryClient, api, id);
    }
  }, [live, queryClient, api, warmKey]);
  useHotkey("mod+alt+arrowdown", () => go(1));
  useHotkey("mod+alt+arrowup", () => go(-1));
  useHotkey("mod+shift+o", () => navigate(newThreadPath(projectId, nodeId)));
  return null;
}
