import type { ConversationSummary } from "@pi-everywhere/protocol";
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarMenu } from "@/components/ui/sidebar";
import { ConversationItem } from "./ConversationItem";

interface ArchivedConversationsProps {
  conversations: ConversationSummary[];
  activeConversationId: string | undefined;
}

export function ArchivedConversations({ conversations, activeConversationId }: ArchivedConversationsProps) {
  if (conversations.length === 0) return null;
  return (
    <Collapsible className="group/archived">
      <CollapsibleTrigger className="flex w-full items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
        <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/archived:rotate-90" />
        Archived ({conversations.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenu>
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeConversationId}
            />
          ))}
        </SidebarMenu>
      </CollapsibleContent>
    </Collapsible>
  );
}
