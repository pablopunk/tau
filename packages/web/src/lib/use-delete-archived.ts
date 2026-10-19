import { useQueryClient } from "@tanstack/react-query";
import type { ConversationSummary, DeleteArchivedResult } from "@tau/protocol";
import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { useApi } from "@/machines/machine-context";

const MAX_LINES = 3;
const INTERRUPTED =
  "Delete interrupted — deletions may still be running. Reload; kept threads reappear under Archived.";

let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

const setPending = (value: Promise<void> | null) => {
  pending = value;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const getInFlight = () => pending !== null;

const plural = (count: number) => `${count} archived thread${count === 1 ? "" : "s"}`;

export function notifyResult(result: DeleteArchivedResult, titles: ReadonlyMap<string, string>) {
  if (result.kept.length === 0) {
    toast.success(`Deleted ${plural(result.deleted.length)}`);
    return;
  }
  const lines = result.kept.slice(0, MAX_LINES).map((k) => `${titles.get(k.id) ?? k.id} — ${k.reason}`);
  const more = result.kept.length - lines.length;
  if (more > 0) lines.push(`…and ${more} more`);
  lines.push("Kept threads stay under Archived with warnings.");
  toast.info(`Deleted ${result.deleted.length}, kept ${result.kept.length}`, {
    description: lines.join("\n"),
  });
}

export function useDeleteArchived() {
  const api = useApi();
  const queryClient = useQueryClient();
  const inFlight = useSyncExternalStore(subscribe, getInFlight);
  const startDeleteArchived = useCallback(
    (force: boolean, archived: readonly ConversationSummary[] = []): boolean => {
      if (pending) {
        toast.info("Already deleting…");
        return false;
      }
      const titles = new Map(archived.map((thread) => [thread.id, thread.title]));
      const run = api.conversations
        .deleteArchived({ force })
        .then((result) => notifyResult(result, titles))
        .catch((error: unknown) => {
          toast.error(isTransport(error) ? INTERRUPTED : errorMessage(error));
        })
        .then(() => queryClient.invalidateQueries({ queryKey: ["conversations"] }))
        .then(
          () => setPending(null),
          () => setPending(null),
        );
      setPending(run);
      return true;
    },
    [api, queryClient],
  );
  return { inFlight, startDeleteArchived };
}

const isTransport = (error: unknown) => !(typeof error === "object" && error !== null && "code" in error);
