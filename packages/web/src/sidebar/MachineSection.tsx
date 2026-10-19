import { useEffect } from "react";
import { SidebarMenuSkeleton } from "@/components/ui/sidebar";
import { errorMessage } from "@/lib/error-message";
import type { SidebarMode } from "@/lib/preferences";
import { useAllConversations, useProjects } from "@/lib/queries";
import { useMachineId } from "@/machines/machine-context";
import { writeSummaryCache } from "@/machines/summary-cache";
import { ProjectsView } from "./ProjectsView";
import { ThreadsView } from "./ThreadsView";

interface MachineSectionProps {
  mode: SidebarMode;
  activeConversationId: string | undefined;
  onProjectRemoved: (projectId: string) => void;
}

/** One machine's projects and threads, under that machine's provider. A failing machine shows its own error only. */
export function MachineSection({ mode, activeConversationId, onProjectRemoved }: MachineSectionProps) {
  const machineId = useMachineId();
  const projects = useProjects();
  const conversations = useAllConversations();
  const View = mode === "threads" ? ThreadsView : ProjectsView;

  useEffect(() => {
    if (machineId === undefined || !projects.data || !conversations.data) return;
    writeSummaryCache(machineId, {
      savedAt: Date.now(),
      projects: projects.data.map(({ id, name }) => ({ id, name })),
      threads: conversations.data
        .filter((thread) => thread.archivedAt === null)
        .map(({ id, projectId, title, updatedAt }) => ({ id, projectId, title, updatedAt })),
    });
  }, [machineId, projects.data, conversations.data]);

  if (projects.isPending) return <SidebarMenuSkeleton showIcon />;
  if (projects.isError)
    return <p className="px-4 text-sm text-destructive">{errorMessage(projects.error)}</p>;
  return (
    <View
      projects={projects.data}
      conversations={conversations.data ?? []}
      activeConversationId={activeConversationId}
      onProjectRemoved={onProjectRemoved}
    />
  );
}
