import type { QueryClient, QueryFunction, QueryKey } from "@tanstack/react-query";
import type { Api } from "./api";
import {
  approvalsOptions,
  goalOptions,
  processesOptions,
  timersOptions,
  workspaceStatusOptions,
} from "./queries";

function prefetch<TData>(
  queryClient: QueryClient,
  options: { queryKey: QueryKey; queryFn: QueryFunction<TData>; staleTime?: number },
): void {
  try {
    void queryClient
      .prefetchQuery<TData>({
        ...options,
        staleTime: Math.max(options.staleTime ?? 0, 5_000),
      })
      .catch(() => {});
  } catch {}
}

export function prefetchThreadData(queryClient: QueryClient, api: Api, conversationId: string): void {
  prefetch(queryClient, approvalsOptions(api, conversationId));
  prefetch(queryClient, goalOptions(api, conversationId));
  prefetch(queryClient, workspaceStatusOptions(api, conversationId));
  prefetch(queryClient, timersOptions(api, conversationId));
  prefetch(queryClient, processesOptions(api, conversationId));
}
