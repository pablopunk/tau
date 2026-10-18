import { type ConversationSummary, unmergedBadgeLabel } from "@tau/protocol";
import { GitBranchIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceStatus } from "@/lib/queries";

const hasWorktree = (conversation: ConversationSummary): boolean =>
  conversation.workspace.mode === "worktree" && conversation.workspace.state !== "removed";

const labelOf = (conversation: ConversationSummary): string => {
  const { branch, base } = conversation.workspace;
  return [branch ?? "worktree", base ? `→ ${base}` : null].filter(Boolean).join(" ");
};

/** Compact mirror of the top-bar WorkspaceChip for the sidebar row's bottom-right corner. */
export function WorktreeIndicator({ conversation }: { conversation: ConversationSummary }) {
  const live = hasWorktree(conversation) && conversation.unmergedWarning === null;
  const status = useWorkspaceStatus(conversation.id, live).data;
  if (!hasWorktree(conversation)) return null;

  if (conversation.unmergedWarning !== null) {
    const short = unmergedBadgeLabel(conversation.unmergedWarning);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={conversation.unmergedWarning}
            className="flex items-center gap-1 text-[11px] text-amber-600 tabular-nums dark:text-amber-400"
          >
            <GitBranchIcon className="size-3" />
            {short}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{conversation.unmergedWarning}</TooltipContent>
      </Tooltip>
    );
  }

  const merged = conversation.workspace.state === "merged";
  const dirty = status?.dirtyFiles.length ?? 0;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const counts = [
    ahead > 0 ? `↑${ahead}` : null,
    behind > 0 ? `↓${behind}` : null,
    dirty > 0 ? `${dirty} uncommitted` : null,
  ].filter(Boolean);
  const attention = dirty > 0 || ahead > 0;
  const cleanMerged = merged && counts.length === 0;
  const detail = cleanMerged ? "merged" : counts.length > 0 ? counts.join(" · ") : status ? "clean" : null;
  const label = detail ? `${labelOf(conversation)} · ${detail}` : labelOf(conversation);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className={
            cleanMerged
              ? "flex items-center gap-1 text-[11px] text-green-500 tabular-nums"
              : attention
                ? "flex items-center gap-1 text-[11px] text-amber-600 tabular-nums dark:text-amber-400"
                : "flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums"
          }
        >
          <GitBranchIcon className="size-3" />
          {cleanMerged ? "merged" : counts.length > 0 ? counts.join(" ") : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
