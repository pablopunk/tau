import { useQueryClient } from "@tanstack/react-query";
import type { Timer } from "@tau/protocol";
import { TimerIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { queryKeys, useAllConversations, useTimers } from "@/lib/queries";
import { TimerRow } from "./TimerRow";
import { useNow } from "./use-now";

function TimersList({ conversationId, open }: { conversationId: string; open: boolean }) {
  const queryClient = useQueryClient();
  const timers = useTimers(conversationId, open);
  const now = useNow(open);

  const remove = async (timer: Timer) => {
    try {
      await api.timers.delete(timer.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.timers(conversationId) });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (timers.isPending) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Spinner /> Loading timers…
      </p>
    );
  }
  if (timers.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-destructive">
          Could not load the timers. {errorMessage(timers.error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => void timers.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (timers.data.length === 0) return <p className="text-muted-foreground">No timers.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {timers.data.map((timer) => (
        <TimerRow key={timer.id} timer={timer} now={now} onDelete={(item) => void remove(item)} />
      ))}
    </ul>
  );
}

export function TimersChip({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const count = useAllConversations().data?.find((item) => item.id === conversationId)?.timers ?? 0;
  if (count === 0 && !open) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`${count} timers`}>
          <TimerIcon />
          {count}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Timers</PopoverTitle>
        </PopoverHeader>
        <TimersList conversationId={conversationId} open={open} />
      </PopoverContent>
    </Popover>
  );
}
