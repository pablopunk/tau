import type { ConversationSummary } from "@tau/protocol";
import { ArrowUpIcon, GitBranchIcon, GitMergeIcon, PencilIcon, TriangleAlertIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceStatus } from "@/lib/queries";

const hasWorktree = (conversation: ConversationSummary): boolean =>
  conversation.workspace.mode === "worktree" && conversation.workspace.state !== "removed";

const labelOf = (conversation: ConversationSummary): string => {
  const { branch, base } = conversation.workspace;
  return [branch ?? "worktree", base ? `→ ${base}` : null].filter(Boolean).join(" ");
};

function ArchivedMarks({ warning }: { warning: string }) {
  const uncommitted = warning.startsWith("Uncommitted changes");
  const commits = warning.startsWith("Unmerged commits") || warning.startsWith("Uncommitted changes and");
  return (
    <>
      {uncommitted && <PencilIcon className="size-2.5" aria-hidden />}
      {commits && <ArrowUpIcon className="size-2.5" aria-hidden />}
      {!uncommitted && !commits && <TriangleAlertIcon className="size-2.5" aria-hidden />}
    </>
  );
}

function LiveMarks({ ahead, behind, dirty }: { ahead: number; behind: number; dirty: number }) {
  return (
    <>
      {ahead > 0 && <span aria-hidden>↑{ahead}</span>}
      {behind > 0 && <span aria-hidden>↓{behind}</span>}
      {dirty > 0 && (
        <span className="inline-flex items-center gap-0.5" aria-hidden>
          <PencilIcon className="size-2.5" />
          {dirty}
        </span>
      )}
    </>
  );
}

/** Icon and counts in the sidebar; the tooltip retains the full worktree description. */
export function WorktreeIndicator({ conversation }: { conversation: ConversationSummary }) {
  const warning = conversation.unmergedWarning;
  const status = useWorkspaceStatus(conversation.id, hasWorktree(conversation) && warning === null).data;
  if (!hasWorktree(conversation)) return null;

  const dirty = status?.dirtyFiles.length ?? 0;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const merged =
    status !== undefined && conversation.workspace.state === "merged" && ahead === 0 && dirty === 0;
  const detail = warning
    ? warning
    : [
        merged ? "merged" : status && ahead === 0 && behind === 0 && dirty === 0 ? "clean" : null,
        ahead > 0 ? `${ahead} ahead` : null,
        behind > 0 ? `${behind} behind` : null,
        dirty > 0 ? `${dirty} uncommitted` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  const label = warning ?? [labelOf(conversation), detail].filter(Boolean).join(" · ");
  const attention = warning !== null || ahead > 0 || dirty > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className={
            attention
              ? "flex items-center gap-1 text-[11px] text-amber-600 tabular-nums dark:text-amber-400"
              : merged
                ? "flex items-center gap-1 text-[11px] text-green-500 tabular-nums"
                : "flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums"
          }
        >
          {merged ? (
            <GitMergeIcon className="size-3" aria-hidden />
          ) : (
            <GitBranchIcon className="size-3" aria-hidden />
          )}
          {warning ? (
            <ArchivedMarks warning={warning} />
          ) : (
            <LiveMarks ahead={ahead} behind={behind} dirty={dirty} />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
