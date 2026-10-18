import type { ConversationSummary } from "@tau/protocol";
import { GitForkIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAllConversations } from "@/lib/queries";

const forkSourceId = (conversation: ConversationSummary): string | null =>
  conversation.agentType === "fork" ? conversation.parentId : (conversation.forkOf?.conversationId ?? null);

export const isFork = (conversation: ConversationSummary): boolean => forkSourceId(conversation) !== null;

export function ForkBadge({ conversation }: { conversation: ConversationSummary }) {
  const sourceId = forkSourceId(conversation);
  const source = useAllConversations().data?.find((item) => item.id === sourceId);
  const label = source ? `Fork of ${source.title.trim() || "New thread"}` : "Fork of another thread";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className="flex size-3.5 items-center justify-center rounded-full bg-sidebar text-muted-foreground ring-1 ring-sidebar-border"
        >
          <GitForkIcon className="size-2.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
