import type { Project } from "@pi-everywhere/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { conversationPath } from "@/lib/paths";
import { queryKeys, useConversations } from "@/lib/queries";
import { ConversationItem } from "./ConversationItem";
import { NameDialog } from "./NameDialog";
import { RemoveProjectDialog } from "./RemoveProjectDialog";

interface ProjectGroupProps {
  project: Project;
  activeConversationId: string | undefined;
  onRemoved: () => void;
}

export function ProjectGroup({ project, activeConversationId, onRemoved }: ProjectGroupProps) {
  const [dialog, setDialog] = useState<"rename" | "remove" | null>(null);
  const conversations = useConversations(project.id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const closeDialog = () => setDialog(null);

  const newChat = async () => {
    try {
      const created = await api.conversations.create(project.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations(project.id) });
      navigate(conversationPath(project.id, created.id));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const rename = async (name: string) => {
    await api.projects.rename(project.id, name);
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  };

  const remove = async () => {
    await api.projects.remove(project.id);
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    onRemoved();
  };

  return (
    <SidebarGroup role="group" aria-label={project.name}>
      <SidebarGroupLabel title={project.path} className="pr-14">
        <span className="truncate">{project.name}</span>
      </SidebarGroupLabel>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarGroupAction aria-label={`Actions for ${project.name}`} className="right-8">
            <MoreHorizontalIcon />
          </SidebarGroupAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onSelect={() => setDialog("rename")}>Rename project</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("remove")}>
            Remove project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SidebarGroupAction aria-label={`New chat in ${project.name}`} title="New chat" onClick={newChat}>
        <PlusIcon />
      </SidebarGroupAction>
      <SidebarGroupContent>
        <SidebarMenu>
          {conversations.isPending && <SidebarMenuSkeleton />}
          {conversations.isError && (
            <p className="px-2 text-xs text-destructive">{errorMessage(conversations.error)}</p>
          )}
          {conversations.data?.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">No chats yet</p>
          )}
          {conversations.data?.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeConversationId}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
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
    </SidebarGroup>
  );
}
