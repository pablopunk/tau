import type { ConversationSummary, Project } from "@tau/protocol";
import { useRef } from "react";
import { useLocation } from "react-router";
import { useFlipList } from "@/hooks/use-flip-list";
import { useNodeId } from "@/nodes/node-context";
import { ProjectGroup } from "./ProjectGroup";
import { isProjectOpen, projectIdFromPath, projectSections } from "./sidebar-model";
import { useProjectOpenOverrides } from "./use-sidebar-preferences";

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
  const { overrides, setOpen } = useProjectOpenOverrides();
  const currentProjectId = projectIdFromPath(useLocation().pathname, useNodeId());
  const sections = projectSections(projects, conversations);
  const openKey = sections.map((section) => isProjectOpen(section, overrides, currentProjectId)).join(",");
  useFlipList(listRef, openKey);
  const byId = new Map(projects.map((project) => [project.id, project]));
  return (
    <div ref={listRef}>
      {sections.map((section) => (
        <ProjectGroup
          key={section.project.id}
          section={section}
          projects={byId}
          activeConversationId={activeConversationId}
          open={isProjectOpen(section, overrides, currentProjectId)}
          onOpenChange={(open) => setOpen(section.project.id, open)}
          onRemoved={() => onProjectRemoved(section.project.id)}
        />
      ))}
    </div>
  );
}
