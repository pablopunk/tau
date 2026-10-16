import type { ConversationSummary, Project } from "@pi-everywhere/protocol";
import { useRef } from "react";
import { useFlipList } from "@/hooks/use-flip-list";
import { ProjectGroup } from "./ProjectGroup";
import { projectSections } from "./sidebar-model";
import { useClosedProjects } from "./use-sidebar-preferences";

interface ProjectsViewProps {
  projects: readonly Project[];
  conversations: readonly ConversationSummary[];
  activeConversationId: string | undefined;
  onProjectRemoved: (projectId: string) => void;
}

export function ProjectsView({
  projects,
  conversations,
  activeConversationId,
  onProjectRemoved,
}: ProjectsViewProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const { closed, isOpen, setOpen } = useClosedProjects();
  useFlipList(listRef, closed.join(","));
  const byId = new Map(projects.map((project) => [project.id, project]));
  return (
    <div ref={listRef}>
      {projectSections(projects, conversations).map((section) => (
        <ProjectGroup
          key={section.project.id}
          section={section}
          projects={byId}
          activeConversationId={activeConversationId}
          open={isOpen(section.project.id)}
          onOpenChange={(open) => setOpen(section.project.id, open)}
          onRemoved={() => onProjectRemoved(section.project.id)}
        />
      ))}
    </div>
  );
}
