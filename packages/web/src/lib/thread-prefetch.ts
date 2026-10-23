import type { QueryClient } from "@tanstack/react-query";
import type { Api } from "./api";

/**
 * No-op contract stub. Agent B should prefetch approvals, goal, and workspace status with the shared
 * query options, skip queries that are already fresh, swallow individual failures, and never throw.
 */
export function prefetchThreadData(queryClient: QueryClient, api: Api, conversationId: string): void {
  void queryClient;
  void api;
  void conversationId;
}
