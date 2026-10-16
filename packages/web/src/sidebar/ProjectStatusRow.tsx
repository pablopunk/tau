import type { Project } from "@pi-everywhere/protocol";
import { useState } from "react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { CloneFailed } from "./CloneFailed";
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import { useRemoveProject } from "./use-remove-project";

/** A cloning or failed project shown in the flat Threads list, so Retry and Remove stay reachable. */
export function ProjectStatusRow({ project, onRemoved }: { project: Project; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false);
  const remove = useRemoveProject(project.id, onRemoved);
  return (
    <SidebarMenuItem aria-label={project.name}>
      <div className="flex items-center gap-2 px-2 py-1 text-sm">
        <span className="truncate">{project.name}</span>
        {project.status === "cloning" && <Spinner className="size-3" aria-label="Cloning" />}
      </div>
      {project.status === "failed" && (
        <CloneFailed projectId={project.id} error={project.error} onRemove={() => setRemoving(true)} />
      )}
      {removing && (
        <RemoveProjectDialog project={project} onConfirm={remove} onClose={() => setRemoving(false)} />
      )}
    </SidebarMenuItem>
  );
}
