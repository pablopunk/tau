import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLiveClient } from "@/conversation";
import { terminalKeys } from "./use-terminals";

/** `Change.resource === "terminals"` refetches the terminal list of that thread. */
export function useTerminalChanges(): void {
  const live = useLiveClient();
  const queryClient = useQueryClient();
  useEffect(
    () =>
      live.onChanged((change) => {
        if (change.resource !== "terminals") return;
        void queryClient.invalidateQueries({ queryKey: terminalKeys.list(change.conversationId) });
      }),
    [live, queryClient],
  );
}
