import { type QueryKey, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ConversationSummary } from "@tau/protocol";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";

/**
 * Shared mutation key for every sidebar/palette thread-list mutation
 * (archive/unarchive/remove/rename, palette toggles). The TkDodo
 * concurrent-mutation guard reads it: `onSettled` invalidates only when no
 * sibling list mutation is still in flight, so a rapid archive→rename→remove
 * never flashes stale UI.
 */
export const THREADS_MUTATION_KEY = ["threads"] as const;

export interface ThreadListMutationOptions<TVariables> {
  /** The thread lists to update optimistically (per-project + all-threads keys). */
  listKeys: readonly QueryKey[];
  mutationFn: (variables: TVariables) => Promise<unknown>;
  /**
   * Trivial in-place transform only: move/remove/rename the row, never
   * re-sort or recompute filters client-side — ordering lives server-side.
   */
  transform: (list: ConversationSummary[], variables: TVariables) => ConversationSummary[];
  toastMessage?: string;
}

/**
 * Standard TanStack optimistic list mutation: `onMutate` cancels in-flight
 * list queries, snapshots, and applies the trivial transform via
 * `setQueryData` (the row moves/disappears/renames instantly — no
 * round-trip linger); `onError` rolls back and toasts; `onSettled`
 * invalidates only when this is the last sibling still mutating.
 */
export function useThreadListMutation<TVariables>(options: ThreadListMutationOptions<TVariables>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: THREADS_MUTATION_KEY,
    mutationFn: options.mutationFn,
    onMutate: async (variables) => {
      await Promise.all(options.listKeys.map((queryKey) => queryClient.cancelQueries({ queryKey })));
      const previous = new Map<QueryKey, ConversationSummary[] | undefined>();
      for (const queryKey of options.listKeys) {
        const list = queryClient.getQueryData<ConversationSummary[]>(queryKey);
        previous.set(queryKey, list);
        if (list !== undefined) queryClient.setQueryData(queryKey, options.transform(list, variables));
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      for (const [queryKey, list] of context?.previous ?? []) {
        queryClient.setQueryData(queryKey, list);
      }
      toast.error(options.toastMessage ?? errorMessage(error));
    },
    onSettled: () => {
      // Sibling guard: only the last mutation still in flight refetches, so
      // concurrent archive→rename→remove settles on one fresh read.
      if (queryClient.isMutating({ mutationKey: THREADS_MUTATION_KEY }) === 1) {
        void Promise.all(options.listKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      }
    },
  });
}
