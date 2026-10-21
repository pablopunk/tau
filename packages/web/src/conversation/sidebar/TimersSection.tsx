import { useQueryClient } from "@tanstack/react-query";
import type { Timer } from "@tau/protocol";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/error-message";
import { queryKeys, useAllConversations, useTimers } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { TimerRow } from "@/timers/TimerRow";
import { useNow } from "@/timers/use-now";
import { SidebarSection } from "./SidebarSection";
import { useAutoExpand } from "./use-auto-expand";

export function TimersSection({ conversationId, revealed }: { conversationId: string; revealed?: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const count = useAllConversations().data?.find((item) => item.id === conversationId)?.timers ?? 0;
  const timers = useTimers(conversationId, true);
  const now = useNow(true);
  const list = timers.data ?? [];
  const expanded = useAutoExpand(list.length > 0 || timers.isError || revealed === true);
  if (timers.isPending) return null;
  if (list.length === 0 && !timers.isError) return null;

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
    <SidebarSection
      sectionId="timers"
      title="Timers"
      count={count}
      open={expanded.open}
      onOpenChange={expanded.onOpenChange}
    >
      {timers.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-xs text-destructive">
            Could not load timers. {errorMessage(timers.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void timers.refetch()}>
            Retry loading timers
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((timer) => (
            <TimerRow key={timer.id} timer={timer} now={now} onDelete={(item) => void remove(item)} />
          ))}
        </ul>
      )}
    </SidebarSection>
  );
}
