import type { Node } from "@tau/protocol";
import { Link } from "react-router";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { conversationPath } from "@/lib/paths";
import { useNodeSummary } from "@/lib/queries";
import { stateLine } from "@/nodes/node-text";
import { readSummaryCache } from "@/nodes/summary-cache";

/** What a node that is not reachable last showed: titles only, greyed, each one opening the calm offline state. */
export function OfflineNodeSection({ node, now }: { node: Node; now: number }) {
  const hubSummary = useNodeSummary(node.id).data;
  const summary = hubSummary ?? readSummaryCache(node.id);
  const threads = summary?.threads ?? [];
  return (
    <SidebarGroupContent className="opacity-60" data-stale>
      <p className="px-2 pb-1 text-xs text-muted-foreground">{stateLine(node, now)}</p>
      {summary === undefined ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">No threads were seen yet.</p>
      ) : (
        summary.projects
          .filter((project) => threads.some((thread) => thread.projectId === project.id))
          .map((project) => (
            <SidebarGroup key={project.id} role="group" aria-label={project.name} className="p-0">
              <SidebarGroupLabel>{project.name}</SidebarGroupLabel>
              <SidebarMenu>
                {threads
                  .filter((thread) => thread.projectId === project.id)
                  .map((thread) => (
                    <SidebarMenuItem key={thread.id}>
                      <SidebarMenuButton asChild size="sm">
                        <Link to={conversationPath(thread.projectId, thread.id, node.id)}>
                          <span className="truncate">{thread.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
              </SidebarMenu>
            </SidebarGroup>
          ))
      )}
    </SidebarGroupContent>
  );
}
