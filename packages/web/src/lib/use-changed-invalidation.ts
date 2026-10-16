import type { Change } from "@pi-everywhere/protocol";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLiveClient } from "@/conversation";
import type { LiveStatus } from "@/conversation/live-client";
import { queryKeys } from "./queries";

function invalidateEverythingListed(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  void queryClient.invalidateQueries({ queryKey: ["conversations"] });
}

function invalidateChange(queryClient: QueryClient, change: Change) {
  if (change.resource === "projects") {
    invalidateEverythingListed(queryClient);
    return;
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(change.projectId) });
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
