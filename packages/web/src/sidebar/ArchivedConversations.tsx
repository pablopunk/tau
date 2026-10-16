import type { ConversationSummary, Project } from "@pi-everywhere/protocol";
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarMenu } from "@/components/ui/sidebar";
import { ThreadRow } from "./ThreadRow";

interface ArchivedConversationsProps {
  conversations: ConversationSummary[];
  activeConversationId: string | undefined;
  projects: ReadonlyMap<string, Project>;
  showProject: boolean;
}

export function ArchivedConversations({
  conversations,
  activeConversationId,
  projects,
  showProject,
}: ArchivedConversationsProps) {
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
            <ThreadRow
              key={conversation.id}
              conversation={conversation}
              project={projects.get(conversation.projectId)}
              active={conversation.id === activeConversationId}
              showProject={showProject}
            />
          ))}
        </SidebarMenu>
      </CollapsibleContent>
    </Collapsible>
  );
}
