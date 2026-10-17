import type { ConversationSummary, WorkspaceStatus } from "@pi-everywhere/protocol";
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

interface WorkspaceMenuProps {
  thread: ConversationSummary;
  status: WorkspaceStatus | undefined;
  disabled: boolean;
  onMerge(): void;
  onCreatePullRequest(): void;
  onRemove(): void;
}

const copyPath = (path: string) => navigator.clipboard?.writeText(path).catch(() => undefined);

export function WorkspaceMenu({
  thread,
  status,
  disabled,
  onMerge,
  onCreatePullRequest,
  onRemove,
}: WorkspaceMenuProps) {
  const { base, path, pullRequestUrl } = thread.workspace;
  const alreadyMerged = thread.workspace.state === "merged" && status?.canMerge === false;
  return (
    <DropdownMenuContent align="start">
      <DropdownMenuItem disabled={disabled || alreadyMerged} onSelect={onMerge}>
        Merge into {base}
      </DropdownMenuItem>
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
