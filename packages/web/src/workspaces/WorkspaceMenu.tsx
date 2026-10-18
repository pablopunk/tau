import type { ConversationSummary, WorkspaceStatus } from "@pi-everywhere/protocol";
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

interface WorkspaceMenuProps {
  thread: ConversationSummary;
  status: WorkspaceStatus | undefined;
  disabled: boolean;
  onMerge(): void;
  onAskToCommit(): void;
  onCreatePullRequest(): void;
  onRemove(): void;
}

const copyPath = (path: string) => navigator.clipboard?.writeText(path).catch(() => undefined);

export function WorkspaceMenu({
  thread,
  status,
  disabled,
  onMerge,
  onAskToCommit,
  onCreatePullRequest,
  onRemove,
}: WorkspaceMenuProps) {
  const { base, path, pullRequestUrl } = thread.workspace;
  const nothingToMerge = status !== undefined && status.unmergedCommits === 0;
  const dirty = (status?.dirtyFiles.length ?? 0) > 0;
  return (
    <DropdownMenuContent align="start">
      <DropdownMenuItem disabled={disabled || nothingToMerge} onSelect={onMerge}>
        Merge into {base}
      </DropdownMenuItem>
      {dirty && (
        <DropdownMenuItem disabled={disabled} onSelect={onAskToCommit}>
          Ask agent to commit
        </DropdownMenuItem>
      )}
      {pullRequestUrl ? (
        <DropdownMenuItem asChild>
          <a href={pullRequestUrl} target="_blank" rel="noreferrer">
            Open pull request
          </a>
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem disabled={disabled} onSelect={onCreatePullRequest}>
          Create PR
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => copyPath(path)}>Copy path</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" disabled={disabled} onSelect={onRemove}>
        Remove worktree
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
