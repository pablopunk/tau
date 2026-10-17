import type { ConversationSummary, Project } from "@pi-everywhere/protocol";
import { useRef } from "react";
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from "@/components/ui/sidebar";
import { useFlipList } from "@/hooks/use-flip-list";
import { ArchivedConversations } from "./ArchivedConversations";
import { ProjectStatusRow } from "./ProjectStatusRow";
import { activeThreads, archivedThreads, nestThreads } from "./sidebar-model";
import { ThreadTree } from "./ThreadTree";

interface ThreadsViewProps {
  projects: readonly Project[];
  conversations: readonly ConversationSummary[];
  activeConversationId: string | undefined;
  onProjectRemoved: (projectId: string) => void;
}

export function ThreadsView({
  projects,
  conversations,
  activeConversationId,
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
  return (
    <SidebarGroup>
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
            {nestThreads(activeThreads(visible)).map((node) => (
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
        <ArchivedConversations
          conversations={archivedThreads(visible)}
          activeConversationId={activeConversationId}
          projects={byId}
          showProject
        />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
