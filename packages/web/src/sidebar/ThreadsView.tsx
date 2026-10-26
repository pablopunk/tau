import type { ConversationSummary, Project } from "@tau/protocol";
import { useRef } from "react";
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from "@/components/ui/sidebar";
import { useFlipList } from "@/hooks/use-flip-list";
import { ProjectStatusRow } from "./ProjectStatusRow";
import { activeThreads, nestThreads } from "./sidebar-model";
import { ThreadTree } from "./ThreadTree";

interface ThreadsViewProps {
  projects: readonly Project[];
  conversations: readonly ConversationSummary[];
  activeConversationId: string | undefined;
  showArchived: boolean;
  onProjectRemoved: (projectId: string) => void;
}

export function ThreadsView({
  projects,
  conversations,
  activeConversationId,
  showArchived,
  onProjectRemoved,
}: ThreadsViewProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useFlipList(listRef, "threads");
  const byId = new Map(projects.map((project) => [project.id, project]));
  const pending = projects.filter((project) => project.status !== "ready");
  const readyIds = new Set(
    projects.filter((project) => project.status === "ready").map((project) => project.id),
  );
  const visible = conversations.filter((conversation) => readyIds.has(conversation.projectId));
  const listed = showArchived ? visible : activeThreads(visible);
  return (
    <SidebarGroup className="p-1">
      <SidebarGroupContent>
        <div ref={listRef}>
          <SidebarMenu>
            {pending.map((project) => (
              <ProjectStatusRow
                key={project.id}
                project={project}
                onRemoved={() => onProjectRemoved(project.id)}
              />
            ))}
            {nestThreads(listed).map((node) => (
              <ThreadTree
                key={node.conversation.id}
                node={node}
                project={byId.get(node.conversation.projectId)}
                projects={byId}
                activeConversationId={activeConversationId}
                showProject
              />
            ))}
          </SidebarMenu>
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
