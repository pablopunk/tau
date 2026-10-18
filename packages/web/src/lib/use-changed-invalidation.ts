import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { Change } from "@tau/protocol";
import { useEffect } from "react";
import { useLiveClient } from "@/conversation";
import type { LiveStatus } from "@/conversation/live-client";
import { invalidateProviders, queryKeys } from "./queries";

function invalidateEverythingListed(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  void queryClient.invalidateQueries({ queryKey: ["conversations"] });
}

function invalidateChange(queryClient: QueryClient, change: Change) {
  if (change.resource === "projects") {
    invalidateEverythingListed(queryClient);
    void queryClient.invalidateQueries({ queryKey: queryKeys.githubRepos });
    return;
  }
  if (change.resource === "providers") {
    void invalidateProviders(queryClient);
    return;
  }
  if (change.resource === "processes") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.processes(change.conversationId) });
    void queryClient.invalidateQueries({ queryKey: ["process-logs"] });
    return;
  }
  if (change.resource === "timers") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.timers(change.conversationId) });
    return;
  }
  if (change.resource === "approvals") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.approvals(change.conversationId) });
    return;
  }
  if (change.resource === "remote") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.remoteStatus });
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    return;
  }
  if (change.resource === "devices") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.devices });
    return;
  }
  if (change.resource === "machines") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.machines });
    return;
  }
  if (change.resource === "mcp") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.allMcpServers });
    return;
  }
  if (change.resource !== "conversations") return;
  void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(change.projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.allConversations });
  void queryClient.invalidateQueries({ queryKey: ["workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["checkpoints"] });
  void queryClient.invalidateQueries({ queryKey: ["goal"] });
}

const isDisconnected = (status: LiveStatus) => status === "reconnecting" || status === "closed";

/** `changed` frames sent while the socket was down are lost, so a reconnect refetches the REST data. */
function refetchAfterReconnect(queryClient: QueryClient) {
  let wasDisconnected = false;
  return (status: LiveStatus) => {
    if (isDisconnected(status)) wasDisconnected = true;
    else if (status === "open" && wasDisconnected) {
      wasDisconnected = false;
      invalidateEverythingListed(queryClient);
    }
  };
}

export function useChangedInvalidation() {
  const live = useLiveClient();
  const queryClient = useQueryClient();
  useEffect(() => live.onChanged((change) => invalidateChange(queryClient, change)), [live, queryClient]);
  useEffect(() => live.onStatus(refetchAfterReconnect(queryClient)), [live, queryClient]);
}
