import type { ConversationSummary, WorkspaceStatus } from "@tau/protocol";
import { GitBranchIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAllConversations, useWorkspaceStatus } from "@/lib/queries";
import { ASK_TO_COMMIT } from "./canned-messages";
import { RemoveWorktreeDialog } from "./RemoveWorktreeDialog";
import { useWorkspaceActions } from "./use-workspace-actions";
import { WorkspaceError } from "./WorkspaceError";
import { WorkspaceMenu } from "./WorkspaceMenu";

const hasWorktree = (thread: ConversationSummary | undefined): thread is ConversationSummary =>
  thread?.workspace?.mode === "worktree" && thread.workspace.state !== "removed";

function ChipCounts({
  status,
  storedMerged,
}: {
  status: WorkspaceStatus | undefined;
  storedMerged: boolean;
}) {
  if (!status) return null;
  const dirty = status.dirtyFiles.length;
  if (storedMerged && status.ahead === 0 && dirty === 0) {
    return <span className="text-muted-foreground">merged</span>;
  }
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
      {dirty > 0 && <span>{dirty} uncommitted</span>}
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
            <ChipCounts status={status} storedMerged={state === "merged"} />
          </Button>
        </DropdownMenuTrigger>
        <WorkspaceMenu
          thread={thread}
          status={status}
          disabled={actions.pending}
          onMerge={actions.merge}
          onAskToCommit={() => actions.sendMessage(ASK_TO_COMMIT)}
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
