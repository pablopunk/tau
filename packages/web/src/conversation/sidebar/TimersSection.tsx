import { useQueryClient } from "@tanstack/react-query";
import type { Timer } from "@tau/protocol";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/error-message";
import { queryKeys, useAllConversations, useTimers } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { TimerRow } from "@/timers/TimerRow";
import { useNow } from "@/timers/use-now";
import { SidebarSection } from "./SidebarSection";

export function TimersSection({ conversationId }: { conversationId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const count = useAllConversations().data?.find((item) => item.id === conversationId)?.timers ?? 0;
  const timers = useTimers(conversationId, true);
  const now = useNow(true);

  const remove = async (timer: Timer) => {
    try {
      await api.timers.delete(timer.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.timers(conversationId) });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <SidebarSection title="Timers" count={count} defaultOpen={count > 0}>
      {timers.isPending ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Loading timers…
        </p>
      ) : timers.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-xs text-destructive">
            Could not load timers. {errorMessage(timers.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void timers.refetch()}>
            Retry
          </Button>
        </div>
      ) : timers.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">No timers.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {timers.data.map((timer) => (
            <TimerRow key={timer.id} timer={timer} now={now} onDelete={(item) => void remove(item)} />
          ))}
        </ul>
      )}
    </SidebarSection>
  );
}
