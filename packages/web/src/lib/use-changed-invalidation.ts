import type { Change } from "@pi-everywhere/protocol";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLiveClient } from "@/conversation";
import { queryKeys } from "./queries";

function invalidateChange(queryClient: QueryClient, change: Change) {
  if (change.resource === "projects") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    return;
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(change.projectId) });
}

export function useChangedInvalidation() {
  const live = useLiveClient();
  const queryClient = useQueryClient();
  useEffect(() => live.onChanged((change) => invalidateChange(queryClient, change)), [live, queryClient]);
}
