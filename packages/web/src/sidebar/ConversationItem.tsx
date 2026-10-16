import type { ConversationSummary } from "@pi-everywhere/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { StatusDot } from "@/components/ui/status-dot";
import { api } from "@/lib/api";
import { conversationPath } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { conversationDot } from "./conversation-dot";
import { DeleteConversationDialog } from "./DeleteConversationDialog";
import { NameDialog } from "./NameDialog";

interface ConversationItemProps {
  conversation: ConversationSummary;
  active: boolean;
}

export function ConversationItem({ conversation, active }: ConversationItemProps) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const title = conversation.title.trim() || "New chat";
  const archived = conversation.archivedAt !== null;
  const dot = conversationDot(conversation, active);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeDialog = () => setDialog(null);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(conversation.projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.allConversations }),
    ]);
  };

  const rename = async (name: string) => {
    await api.conversations.rename(conversation.id, name);
    await refresh();
  };

  const toggleArchive = async () => {
    await api.conversations.archive(conversation.id, !archived);
    await refresh();
  };

  const remove = async () => {
    await api.conversations.remove(conversation.id);
    await refresh();
    if (active) navigate("/");
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={title}>
        <Link
          to={conversationPath(conversation.projectId, conversation.id)}
          aria-current={active ? "page" : undefined}
          onClick={() => isMobile && setOpenMobile(false)}
        >
          {dot && <StatusDot status={dot} />}
          <span className="truncate">{title}</span>
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction aria-label={`Actions for ${title}`}>
            <MoreHorizontalIcon />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onSelect={() => setDialog("rename")}>Rename chat</DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleArchive}>{archived ? "Unarchive" : "Archive"}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "rename" && (
        <NameDialog
          title="Rename chat"
          label="Title"
          initialValue={conversation.title}
          onSubmit={rename}
          onClose={closeDialog}
        />
      )}
      {dialog === "delete" && (
        <DeleteConversationDialog title={title} onConfirm={remove} onClose={closeDialog} />
      )}
    </SidebarMenuItem>
  );
}
