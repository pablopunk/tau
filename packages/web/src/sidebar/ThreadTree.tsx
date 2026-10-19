import type { Project } from "@tau/protocol";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { SidebarMenuSub } from "@/components/ui/sidebar";
import type { ThreadNode } from "./sidebar-model";
import { ThreadRow } from "./ThreadRow";
import { useCollapsedThreads } from "./use-sidebar-preferences";

interface ThreadTreeProps {
  node: ThreadNode;
  project: Project | undefined;
  projects: ReadonlyMap<string, Project>;
  activeConversationId: string | undefined;
  showProject: boolean;
}

export function ThreadTree({ node, project, projects, activeConversationId, showProject }: ThreadTreeProps) {
  const { conversation, children } = node;
  const { isExpanded, toggle } = useCollapsedThreads();
  const expanded = isExpanded(conversation.id);
  const row = (
    <ThreadRow
      conversation={conversation}
      project={project}
      active={conversation.id === activeConversationId}
      showProject={showProject}
      branches={children.length > 0 ? { expanded, onToggle: () => toggle(conversation.id) } : undefined}
    />
  );
  if (children.length === 0) return row;
  return (
    <Collapsible open={expanded} data-testid={`thread-tree-${conversation.id}`}>
      {row}
      <CollapsibleContent>
        <SidebarMenuSub className="mr-0 ml-5">
          {children.map((child, index) => (
            <ThreadRow
              key={child.id}
              depth={1}
              last={index === children.length - 1}
              conversation={child}
              project={projects.get(child.projectId) ?? project}
              active={child.id === activeConversationId}
              showProject={showProject}
            />
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}
