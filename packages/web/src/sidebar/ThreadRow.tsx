import { useQueryClient } from "@tanstack/react-query";
import type { ConversationSummary, Project } from "@tau/protocol";
import { ArchiveIcon, ArchiveRestoreIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { BotAvatar } from "@/components/ui/bot-avatar";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { TreeBranch, TreeToggle } from "@/components/ui/tree-branch";
import { api } from "@/lib/api";
import { conversationPath } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { conversationDot } from "./conversation-dot";
import { DeleteConversationDialog } from "./DeleteConversationDialog";
import { ForkBadge, isFork } from "./ForkBadge";
import { NameDialog } from "./NameDialog";
import { ThreadMenuItems } from "./ThreadMenuItems";

interface ThreadRowProps {
  conversation: ConversationSummary;
  project: Project | undefined;
  active: boolean;
  /** Threads mode shows the project icon and name above the title. */
  showProject: boolean;
  /** 1 for a subagent thread shown under its parent. */
  depth?: number;
  /** Only for a child: it is the last of its siblings. */
  last?: boolean;
  /** Only for a parent with children. */
  branches?: { expanded: boolean };
}

const tooltipOf = (title: string, project: Project | undefined, conversation: ConversationSummary) =>
  [title, conversation.agentType, project?.name, conversation.model?.modelId, conversation.status]
    .filter(Boolean)
    .join(" · ");

export function ThreadRow({
  conversation,
  project,
  active,
  showProject,
  depth = 0,
  last = false,
  branches,
}: ThreadRowProps) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const remove = async (force: boolean) => {
    await api.conversations.remove(conversation.id, { force });
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

  const decoration =
    depth > 0 ? (
      <TreeBranch last={last} />
    ) : branches ? (
      <TreeToggle
        expanded={branches.expanded}
        aria-label={`${branches.expanded ? "Collapse" : "Expand"} subagents of ${title}`}
      />
    ) : undefined;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <SidebarThreadRow
            actionsOpen={menuOpen}
            data-depth={depth}
            compact={depth > 0}
            decoration={decoration}
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
                size={depth > 0 ? 20 : 24}
                avatarIndex={conversation.avatarIndex}
                working={conversation.status === "running"}
                badge={dot && dot !== "running" ? <StatusDot status={dot} /> : undefined}
                originBadge={isFork(conversation) ? <ForkBadge conversation={conversation} /> : undefined}
              />
            }
            context={depth === 0 && showProject ? project?.name : undefined}
            projectIcon={depth > 0 ? undefined : projectIcon(17)}
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
                <DropdownMenu onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${title}`}>
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start">
                    <ThreadMenuItems
                      Item={DropdownMenuItem}
                      archived={archived}
                      onRename={() => setDialog("rename")}
                      onArchive={toggleArchive}
                      onDelete={() => setDialog("delete")}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            }
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ThreadMenuItems
            Item={ContextMenuItem}
            archived={archived}
            onRename={() => setDialog("rename")}
            onArchive={toggleArchive}
            onDelete={() => setDialog("delete")}
          />
        </ContextMenuContent>
      </ContextMenu>
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
