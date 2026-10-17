import type { ConversationSummary, Project } from "@pi-everywhere/protocol";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarMenu } from "@/components/ui/sidebar";
import { DeleteArchivedDialog } from "./DeleteArchivedDialog";
import { ThreadRow } from "./ThreadRow";
import { UnmergedWarning } from "./UnmergedWarning";

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
  const [confirming, setConfirming] = useState(false);
  if (conversations.length === 0) return null;
  const topLevel = conversations.filter((conversation) => conversation.parentId === null);
  return (
    <Collapsible className="group/archived">
      <div className="flex items-center justify-between pr-1">
        <CollapsibleTrigger className="flex flex-1 items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
          <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/archived:rotate-90" />
          Archived ({conversations.length})
        </CollapsibleTrigger>
        {showProject && (
          <Button variant="ghost" size="xs" onClick={() => setConfirming(true)}>
            Delete all archived
          </Button>
        )}
      </div>
      {confirming && <DeleteArchivedDialog archived={topLevel} onClose={() => setConfirming(false)} />}
      <CollapsibleContent>
        <SidebarMenu>
          {conversations.map((conversation) => (
            <Fragment key={conversation.id}>
              <ThreadRow
                conversation={conversation}
                project={projects.get(conversation.projectId)}
                active={conversation.id === activeConversationId}
                showProject={showProject}
              />
              {conversation.unmergedWarning !== null && (
                <UnmergedWarning message={conversation.unmergedWarning} />
              )}
            </Fragment>
          ))}
        </SidebarMenu>
      </CollapsibleContent>
    </Collapsible>
  );
}
