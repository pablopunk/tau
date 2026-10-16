import type { ConversationSummary } from "@pi-everywhere/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import { conversationPath } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { NameDialog } from "./NameDialog";

interface ConversationItemProps {
  conversation: ConversationSummary;
  active: boolean;
}

export function ConversationItem({ conversation, active }: ConversationItemProps) {
  const [renaming, setRenaming] = useState(false);
  const title = conversation.title.trim() || "New chat";
  const queryClient = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();

  const rename = async (title: string) => {
    await api.conversations.rename(conversation.id, title);
    await queryClient.invalidateQueries({ queryKey: queryKeys.conversations(conversation.projectId) });
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={title}>
        <Link
          to={conversationPath(conversation.projectId, conversation.id)}
          aria-current={active ? "page" : undefined}
          onClick={() => isMobile && setOpenMobile(false)}
        >
          <span className="truncate">{title}</span>
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={`Actions for ${title}`}>
            <MoreHorizontalIcon />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename chat</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {renaming && (
        <NameDialog
          title="Rename chat"
          label="Title"
          initialValue={conversation.title}
          onSubmit={rename}
          onClose={() => setRenaming(false)}
        />
      )}
    </SidebarMenuItem>
  );
}
