import type { Project } from "@pi-everywhere/protocol";
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ThreadNode } from "./sidebar-model";
import { ThreadRow } from "./ThreadRow";

interface ThreadTreeProps {
  node: ThreadNode;
  project: Project | undefined;
  projects: ReadonlyMap<string, Project>;
  activeConversationId: string | undefined;
  showProject: boolean;
}

export function ThreadTree({ node, project, projects, activeConversationId, showProject }: ThreadTreeProps) {
  const { conversation, children } = node;
  const row = (
    <ThreadRow
      conversation={conversation}
      project={project}
      active={conversation.id === activeConversationId}
      showProject={showProject}
    />
  );
  if (children.length === 0) return row;
  return (
    <Collapsible defaultOpen className="group/children" data-testid={`thread-tree-${conversation.id}`}>
      {row}
      <CollapsibleTrigger className="flex w-full items-center gap-1 px-4 py-0.5 text-xs text-muted-foreground">
        <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/children:rotate-90" />
        Subagents ({children.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        {children.map((child) => (
          <ThreadRow
            key={child.id}
            depth={1}
            conversation={child}
            project={projects.get(child.projectId) ?? project}
            active={child.id === activeConversationId}
            showProject={showProject}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
