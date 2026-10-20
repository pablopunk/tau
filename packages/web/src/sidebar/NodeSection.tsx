import { useEffect } from "react";
import { SidebarMenuSkeleton } from "@/components/ui/sidebar";
import { errorMessage } from "@/lib/error-message";
import type { SidebarMode } from "@/lib/preferences";
import { useAllConversations, useProjects } from "@/lib/queries";
import { useNodeId } from "@/nodes/node-context";
import { writeSummaryCache } from "@/nodes/summary-cache";
import { ProjectsView } from "./ProjectsView";
import { ThreadsView } from "./ThreadsView";

interface NodeSectionProps {
  mode: SidebarMode;
  showArchived: boolean;
  activeConversationId: string | undefined;
  onProjectRemoved: (projectId: string) => void;
}

/** One node's projects and threads, under that node's provider. A failing node shows its own error only. */
export function NodeSection({
  mode,
  showArchived,
  activeConversationId,
  onProjectRemoved,
}: NodeSectionProps) {
  const nodeId = useNodeId();
  const projects = useProjects();
  const conversations = useAllConversations();
  const View = mode === "threads" ? ThreadsView : ProjectsView;

  useEffect(() => {
    if (nodeId === undefined || !projects.data || !conversations.data) return;
    writeSummaryCache(nodeId, {
      savedAt: Date.now(),
      projects: projects.data.map(({ id, name }) => ({ id, name })),
      threads: conversations.data
        .filter((thread) => thread.archivedAt === null)
        .map(({ id, projectId, title, updatedAt }) => ({ id, projectId, title, updatedAt })),
    });
  }, [nodeId, projects.data, conversations.data]);

  if (projects.isPending) return <SidebarMenuSkeleton showIcon />;
  if (projects.isError)
    return <p className="px-4 text-sm text-destructive">{errorMessage(projects.error)}</p>;
  return (
    <View
      projects={projects.data}
      conversations={conversations.data ?? []}
      activeConversationId={activeConversationId}
      showArchived={showArchived}
      onProjectRemoved={onProjectRemoved}
    />
  );
}
