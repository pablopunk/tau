import type { ConversationSummary, Project } from "@tau/protocol";
import { ArchiveIcon, ArchiveRestoreIcon, MoreHorizontalIcon } from "lucide-react";
import { type MouseEvent, useState } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TreeBranch } from "@/components/ui/tree-branch";
import { PendingApprovalBadge } from "@/conversation/PendingApprovalBadge";
import { useThreadListMutation } from "@/conversation/queue/thread-list-mutations";
import { conversationPath, nodeAssetUrl } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { useApi, useNodeId } from "@/nodes/node-context";
import { conversationDot } from "./conversation-dot";
import { DeleteConversationDialog } from "./DeleteConversationDialog";
import { ForkBadge, isFork } from "./ForkBadge";
import { GoalBadge, hasActiveGoal } from "./GoalBadge";
import { NameDialog } from "./NameDialog";
import { ThreadMenuItems } from "./ThreadMenuItems";
import { hasTimer, TimerBadge } from "./TimerBadge";
import { useWarmOnIntent } from "./use-warm-on-intent";
import { WorktreeIndicator } from "./WorktreeIndicator";

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
  branches?: { expanded: boolean; onToggle: () => void };
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
  const nodeId = useNodeId();
  const api = useApi();
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const title = conversation.title.trim() || "New thread";
  const archived = conversation.archivedAt !== null;
  const archiveAction = archived ? "Unarchive" : "Archive";
  const archiveLabel = `${archiveAction} ${title}`;
  const dot = conversationDot(conversation, active, nodeId);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeDialog = () => setDialog(null);
  const hasWorktree =
    conversation.workspace.mode === "worktree" && conversation.workspace.state !== "removed";
  const { handlers: warm } = useWarmOnIntent(conversation.id, true, hasWorktree);

  const listKeys = [queryKeys.conversations(conversation.projectId), queryKeys.allConversations] as const;
  const renameMutation = useThreadListMutation({
    listKeys: [...listKeys],
    mutationFn: (name: string) => api.conversations.rename(conversation.id, name),
    transform: (list, name) =>
      list.map((item) => (item.id === conversation.id ? { ...item, title: name } : item)),
  });
  const archiveMutation = useThreadListMutation({
    listKeys: [...listKeys],
    mutationFn: (next: boolean) => api.conversations.archive(conversation.id, next),
    transform: (list, next) =>
      list.map((item) =>
        item.id === conversation.id ? { ...item, archivedAt: next ? Date.now() : null } : item,
      ),
  });
  const removeMutation = useThreadListMutation({
    listKeys: [...listKeys],
    mutationFn: (force: boolean) => api.conversations.remove(conversation.id, { force }),
    transform: (list) => list.filter((item) => item.id !== conversation.id),
  });
  // Rename closes its dialog at once: the row already shows the new name, and a refusal puts the old one back
  // with a toast. Delete still waits, because it can be refused for reasons the dialog has to explain.
  const rename = async (name: string): Promise<void> => {
    renameMutation.mutate(name);
  };
  const toggleArchive = () => {
    archiveMutation.mutate(!archived);
  };
  const remove = (force: boolean): Promise<void> =>
    removeMutation.mutateAsync(force).then(() => {
      if (active) navigate("/");
    });

  const projectIcon = (tile: number) =>
    project ? (
      <ProjectIcon
        id={project.id}
        name={project.name}
        iconUrl={project.iconUrl ? nodeAssetUrl(project.iconUrl, nodeId) : null}
        home={project.kind === "home"}
        tile={tile}
      />
    ) : null;
  const ArchiveToggleIcon = archived ? ArchiveRestoreIcon : ArchiveIcon;

  const decoration = depth > 0 ? <TreeBranch last={last} /> : undefined;
  const followLink = (event: MouseEvent) => {
    if (active && branches) {
      event.preventDefault();
      branches.onToggle();
      return;
    }
    if (isMobile) setOpenMobile(false);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <SidebarThreadRow
            actionsOpen={menuOpen}
            data-depth={depth}
            {...warm}
            compact={depth > 0}
            decoration={decoration}
            flipId={conversation.id}
            current={active}
            title={title}
            tooltip={tooltipOf(title, project, conversation)}
            link={
              <Link
                to={conversationPath(conversation.projectId, conversation.id, nodeId)}
                aria-current={active ? "page" : undefined}
                aria-expanded={branches?.expanded}
                onClick={followLink}
              />
            }
            avatar={
              archived ? (
                <ArchiveIcon
                  aria-label="Archived"
                  className={depth > 0 ? "size-3.5 text-muted-foreground" : "size-4 text-muted-foreground"}
                />
              ) : (
                <BotAvatar
                  size={depth > 0 ? 20 : 24}
                  avatarIndex={conversation.avatarIndex}
                  working={conversation.status === "running"}
                  badge={dot && dot !== "running" ? <StatusDot status={dot} /> : undefined}
                  originBadge={isFork(conversation) ? <ForkBadge conversation={conversation} /> : undefined}
                  goalBadge={
                    hasActiveGoal(conversation) ? <GoalBadge conversation={conversation} /> : undefined
                  }
                  timerBadge={hasTimer(conversation) ? <TimerBadge conversation={conversation} /> : undefined}
                />
              )
            }
            context={depth === 0 && showProject ? project?.name : undefined}
            projectIcon={depth > 0 ? undefined : projectIcon(17)}
            worktree={depth === 0 ? <WorktreeIndicator conversation={conversation} /> : undefined}
            time={
              <>
                {depth > 0 ? (
                  <PendingApprovalBadge
                    conversationId={conversation.id}
                    enabled={conversation.status === "running"}
                  />
                ) : null}
                <RelativeTime at={conversation.lastActivityAt} animate />
              </>
            }
            actions={
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={archiveLabel} onClick={toggleArchive}>
                      <ArchiveToggleIcon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{archiveAction}</TooltipContent>
                </Tooltip>
                <DropdownMenu onOpenChange={setMenuOpen}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${title}`}>
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="top">Actions</TooltipContent>
                  </Tooltip>
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
