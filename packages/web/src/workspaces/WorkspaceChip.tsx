import type { ConversationSummary, WorkspaceStatus } from "@pi-everywhere/protocol";
import { GitBranchIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAllConversations, useWorkspaceStatus } from "@/lib/queries";
import { RemoveWorktreeDialog } from "./RemoveWorktreeDialog";
import { useWorkspaceActions } from "./use-workspace-actions";
import { WorkspaceError } from "./WorkspaceError";
import { WorkspaceMenu } from "./WorkspaceMenu";

const hasWorktree = (thread: ConversationSummary | undefined): thread is ConversationSummary =>
  thread?.workspace?.mode === "worktree" && thread.workspace.state !== "removed";

function ChipCounts({ status }: { status: WorkspaceStatus | undefined }) {
  if (!status) return null;
  return (
    <span className="flex gap-1 text-muted-foreground">
      {status.ahead > 0 && (
        <span role="img" aria-label={`${status.ahead} ahead`}>
          ↑{status.ahead}
        </span>
      )}
      {status.behind > 0 && (
        <span role="img" aria-label={`${status.behind} behind`}>
          ↓{status.behind}
        </span>
      )}
      {status.dirtyFiles.length > 0 && (
        <span role="img" aria-label={`${status.dirtyFiles.length} changed files`}>
          ●{status.dirtyFiles.length}
        </span>
      )}
    </span>
  );
}

export function WorkspaceChip({ conversationId }: { conversationId: string }) {
  const thread = useAllConversations().data?.find((summary) => summary.id === conversationId);
  const status = useWorkspaceStatus(conversationId, hasWorktree(thread)).data;
  const actions = useWorkspaceActions(conversationId);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  if (!hasWorktree(thread)) return null;
  const { branch, base, state } = thread.workspace;

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="xs" aria-label="Workspace">
            <GitBranchIcon />
            <span className="max-w-40 truncate">{branch}</span>
            {state === "merged" ? (
              <span className="text-muted-foreground">merged</span>
            ) : (
              <ChipCounts status={status} />
            )}
          </Button>
        </DropdownMenuTrigger>
        <WorkspaceMenu
          thread={thread}
          status={status}
          disabled={actions.pending}
          onMerge={actions.merge}
          onCreatePullRequest={actions.createPullRequest}
          onRemove={() => setConfirmingRemove(true)}
        />
      </DropdownMenu>
      {actions.failure && (
        <WorkspaceError
          failure={actions.failure}
          base={base ?? "the base branch"}
          disabled={actions.pending}
          onSend={actions.sendMessage}
          onDismiss={actions.dismiss}
        />
      )}
      {confirmingRemove && (
        <RemoveWorktreeDialog
          branch={branch ?? "worktree"}
          status={status}
          pending={actions.pending}
          onClose={() => setConfirmingRemove(false)}
          onConfirm={async (force) => {
            if (await actions.remove(force)) setConfirmingRemove(false);
          }}
        />
      )}
    </div>
  );
}
