import type { ConversationSummary, Project } from "@pi-everywhere/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ArchiveRestoreIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { BotAvatar } from "@/components/ui/bot-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectIcon } from "@/components/ui/project-icon";
import { RelativeTime } from "@/components/ui/relative-time";
import { useSidebar } from "@/components/ui/sidebar";
import { SidebarThreadRow } from "@/components/ui/sidebar-thread-row";
import { StatusDot } from "@/components/ui/status-dot";
import { api } from "@/lib/api";
import { conversationPath } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { conversationDot } from "./conversation-dot";
import { DeleteConversationDialog } from "./DeleteConversationDialog";
import { NameDialog } from "./NameDialog";

interface ThreadRowProps {
  conversation: ConversationSummary;
  project: Project | undefined;
  active: boolean;
  /** Threads mode shows the project icon and name above the title. */
  showProject: boolean;
}

const tooltipOf = (title: string, project: Project | undefined, conversation: ConversationSummary) =>
  [title, project?.name, conversation.model?.modelId, conversation.status].filter(Boolean).join(" · ");

export function ThreadRow({ conversation, project, active, showProject }: ThreadRowProps) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const title = conversation.title.trim() || "New thread";
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
    if (active) navigate("/");
    await refresh();
  };

  const projectIcon = (tile: number) =>
    project ? (
      <ProjectIcon
        id={project.id}
        name={project.name}
        iconUrl={project.iconUrl}
        home={project.kind === "home"}
        tile={tile}
      />
    ) : null;
  const ArchiveToggleIcon = archived ? ArchiveRestoreIcon : ArchiveIcon;

  return (
    <>
      <SidebarThreadRow
        flipId={conversation.id}
        current={active}
        title={title}
        tooltip={tooltipOf(title, project, conversation)}
        link={
          <Link
            to={conversationPath(conversation.projectId, conversation.id)}
            aria-current={active ? "page" : undefined}
            onClick={() => isMobile && setOpenMobile(false)}
          />
        }
        avatar={
          <BotAvatar
            avatarIndex={conversation.avatarIndex}
            working={conversation.status === "running"}
            badge={dot && dot !== "running" ? <StatusDot status={dot} /> : undefined}
          />
        }
        context={
          showProject && project ? (
            <>
              {projectIcon(14)}
              <span className="truncate">{project.name}</span>
            </>
          ) : undefined
        }
        takeover={projectIcon(24)}
        takeoverFrom={showProject ? "context" : "fade"}
        time={<RelativeTime at={conversation.lastActivityAt} />}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${archived ? "Unarchive" : "Archive"} ${title}`}
              onClick={toggleArchive}
            >
              <ArchiveToggleIcon />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${title}`}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuItem onSelect={() => setDialog("rename")}>Rename thread</DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleArchive}>
                  {archived ? "Unarchive" : "Archive"}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      {dialog === "rename" && (
        <NameDialog
          title="Rename thread"
          label="Title"
          initialValue={conversation.title}
          onSubmit={rename}
          onClose={closeDialog}
        />
      )}
      {dialog === "delete" && (
        <DeleteConversationDialog title={title} onConfirm={remove} onClose={closeDialog} />
      )}
    </>
  );
}
