import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@tau/protocol";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectIcon } from "@/components/ui/project-icon";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { ChangeIconDialog } from "@/icons/ChangeIconDialog";
import { homeRelative, newThreadPath, nodeAssetUrl } from "@/lib/paths";
import { byActivity, queryKeys } from "@/lib/queries";
import { useApi, useNodeId } from "@/nodes/node-context";
import { ChangeFolderDialog } from "./ChangeFolderDialog";
import { CloneFailed } from "./CloneFailed";
import { NameDialog } from "./NameDialog";
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import { nestThreads, type ProjectSection } from "./sidebar-model";
import { ThreadTree } from "./ThreadTree";
import { useRemoveProject } from "./use-remove-project";

interface ProjectGroupProps {
  section: ProjectSection;
  projects: ReadonlyMap<string, Project>;
  activeConversationId: string | undefined;
  showArchived: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}

type Dialog = "rename" | "remove" | "icon" | "folder" | null;

export function ProjectGroup({
  section,
  projects,
  activeConversationId,
  showArchived,
  open,
  onOpenChange,
  onRemoved,
}: ProjectGroupProps) {
  const api = useApi();
  const nodeId = useNodeId();
  const { project, active, archived } = section;
  const listed = showArchived ? [...active, ...archived].sort(byActivity) : active;
  const [dialog, setDialog] = useState<Dialog>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const closeDialog = () => setDialog(null);
  const isHome = project.kind === "home";
  const remove = useRemoveProject(project.id, onRemoved);

  const rename = async (name: string) => {
    await api.projects.rename(project.id, name);
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  };

  return (
    <SidebarGroup
      role="group"
      aria-label={project.name}
      className="rounded-md p-1 has-[>div>[data-group-header]:hover]:bg-sidebar-accent has-[>div>[data-slot=sidebar-group-action]:hover]:bg-sidebar-accent"
    >
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <SidebarGroupLabel asChild title={homeRelative(project.path)} className="pr-14">
          <CollapsibleTrigger data-group-header className="w-full cursor-pointer gap-1.5">
            <ProjectIcon
              id={project.id}
              name={project.name}
              iconUrl={project.iconUrl ? nodeAssetUrl(project.iconUrl, nodeId) : null}
              home={isHome}
            />
            <span className="truncate">{project.name}</span>
            {project.status === "cloning" && <Spinner className="ml-1 size-3" aria-label="Cloning" />}
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarGroupAction aria-label={`Actions for ${project.name}`} className="right-8">
              <MoreHorizontalIcon />
            </SidebarGroupAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            {project.status === "ready" && (
              <DropdownMenuItem onSelect={() => navigate(newThreadPath(project.id, nodeId))}>
                New thread
              </DropdownMenuItem>
            )}
            {!isHome && (
              <>
                <DropdownMenuItem onSelect={() => setDialog("rename")}>Rename project</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("icon")}>Change icon</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("folder")}>Change folder…</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog("remove")}>
                  Remove project
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <p className="px-2 py-1 text-xs text-muted-foreground">{homeRelative(project.path)}</p>
          </DropdownMenuContent>
        </DropdownMenu>
        {project.status === "ready" && (
          <SidebarGroupAction
            aria-label={`New thread in ${project.name}`}
            title="New thread"
            onClick={() => navigate(newThreadPath(project.id, nodeId))}
          >
            <PlusIcon />
          </SidebarGroupAction>
        )}
        <CollapsibleContent className="pl-2">
          {project.status === "failed" && (
            <CloneFailed projectId={project.id} error={project.error} onRemove={() => setDialog("remove")} />
          )}
          {project.status === "ready" && (
            <SidebarGroupContent>
              <SidebarMenu>
                {listed.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">No threads yet</p>
                )}
                {nestThreads(listed).map((node) => (
                  <ThreadTree
                    key={node.conversation.id}
                    node={node}
                    project={project}
                    projects={projects}
                    activeConversationId={activeConversationId}
                    showProject={false}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          )}
        </CollapsibleContent>
      </Collapsible>
      {dialog === "rename" && (
        <NameDialog
          title="Rename project"
          label="Name"
          initialValue={project.name}
          onSubmit={rename}
          onClose={closeDialog}
        />
      )}
      {dialog === "remove" && (
        <RemoveProjectDialog project={project} onConfirm={remove} onClose={closeDialog} />
      )}
      {dialog === "folder" && <ChangeFolderDialog project={project} onClose={closeDialog} />}
      {dialog === "icon" && <ChangeIconDialog project={project} onClose={closeDialog} />}
    </SidebarGroup>
  );
}
