import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@tau/protocol";
import { ChevronRightIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
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
import { api } from "@/lib/api";
import { newThreadPath } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { ArchivedConversations } from "./ArchivedConversations";
import { ChangeFolderDialog } from "./ChangeFolderDialog";
import { CloneFailed } from "./CloneFailed";
import { NameDialog } from "./NameDialog";
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import { homeRelative, nestThreads, type ProjectSection } from "./sidebar-model";
import { ThreadTree } from "./ThreadTree";
import { useRemoveProject } from "./use-remove-project";

interface ProjectGroupProps {
  section: ProjectSection;
  projects: ReadonlyMap<string, Project>;
  activeConversationId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}

type Dialog = "rename" | "remove" | "icon" | "folder" | null;

export function ProjectGroup({
  section,
  projects,
  activeConversationId,
  open,
  onOpenChange,
  onRemoved,
}: ProjectGroupProps) {
  const { project, active, archived } = section;
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
    <SidebarGroup role="group" aria-label={project.name}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <SidebarGroupLabel asChild title={project.path} className="pr-14">
          <CollapsibleTrigger className="w-full gap-1.5">
            <ChevronRightIcon className={open ? "rotate-90 transition-transform" : "transition-transform"} />
            <ProjectIcon id={project.id} name={project.name} iconUrl={project.iconUrl} home={isHome} />
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
              <DropdownMenuItem onSelect={() => navigate(newThreadPath(project.id))}>
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
            onClick={() => navigate(newThreadPath(project.id))}
          >
            <PlusIcon />
          </SidebarGroupAction>
        )}
        <CollapsibleContent>
          {project.status === "failed" && (
            <CloneFailed projectId={project.id} error={project.error} onRemove={() => setDialog("remove")} />
          )}
          {project.status === "ready" && (
            <SidebarGroupContent>
              <SidebarMenu>
                {active.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">No threads yet</p>
                )}
                {nestThreads(active).map((node) => (
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
              <ArchivedConversations
                conversations={archived}
                activeConversationId={activeConversationId}
                projects={projects}
                showProject={false}
              />
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
