import { GitBranchIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAllConversations, useWorkspaceStatus } from "@/lib/queries";
import { ASK_TO_COMMIT } from "@/workspaces/canned-messages";
import { RemoveWorktreeDialog } from "@/workspaces/RemoveWorktreeDialog";
import { useWorkspaceActions } from "@/workspaces/use-workspace-actions";
import { WorkspaceError } from "@/workspaces/WorkspaceError";
import { SidebarSection } from "./SidebarSection";

export function WorktreeSection({ conversationId }: { conversationId: string }) {
  const thread = useAllConversations().data?.find((summary) => summary.id === conversationId);
  const workspace = thread?.workspace;
  const isWorktree = workspace?.mode === "worktree" && workspace.state !== "removed";
  const status = useWorkspaceStatus(conversationId, isWorktree).data;
  const actions = useWorkspaceActions(conversationId);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  if (!workspace || workspace.mode !== "worktree") return null;
  if (workspace.state === "removed") return null;

  const dirty = status?.dirtyFiles ?? [];
  const nothingToMerge = status !== undefined && status.unmergedCommits === 0;
  return (
    <SidebarSection sectionId="worktree" title="Worktree" defaultOpen>
      <div className="flex items-center gap-1.5 text-sm">
        <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{workspace.branch ?? "worktree"}</span>
        {status ? (
          <span className="flex shrink-0 gap-1 text-xs text-muted-foreground">
            {workspace.state === "merged" && status.ahead === 0 && dirty.length === 0 ? (
              <span>merged</span>
            ) : (
              <>
                {status.ahead > 0 ? <span>↑{status.ahead}</span> : null}
                {status.behind > 0 ? <span>↓{status.behind}</span> : null}
                {dirty.length > 0 ? <span>{dirty.length} uncommitted</span> : null}
                {status.unmergedCommits > 0 ? <span>{status.unmergedCommits} to merge</span> : null}
              </>
            )}
          </span>
        ) : null}
      </div>
      {dirty.length > 0 ? (
        <ul aria-label="Changed files" className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
          {dirty.map((path) => (
            <li key={path} className="truncate font-mono text-xs text-muted-foreground" title={path}>
              {path}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {status ? "Working tree clean." : "Loading status…"}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={actions.pending || nothingToMerge}
          onClick={actions.merge}
        >
          Merge
        </Button>
        {dirty.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={actions.pending}
            onClick={() => void actions.sendMessage(ASK_TO_COMMIT)}
          >
            Ask to commit
          </Button>
        ) : null}
        {!workspace.pullRequestUrl ? (
          <Button variant="outline" size="sm" disabled={actions.pending} onClick={actions.createPullRequest}>
            Create PR
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setConfirmingRemove(true)}>
          Remove…
        </Button>
      </div>
      {actions.failure ? (
        <div className="mt-2">
          <WorkspaceError
            failure={actions.failure}
            base={workspace.base ?? "the base branch"}
            disabled={actions.pending}
            onSend={actions.sendMessage}
            onDismiss={actions.dismiss}
          />
        </div>
      ) : null}
      {confirmingRemove ? (
        <RemoveWorktreeDialog
          branch={workspace.branch ?? "worktree"}
          status={status}
          pending={actions.pending}
          onClose={() => setConfirmingRemove(false)}
          onConfirm={async (force) => {
            if (await actions.remove(force)) setConfirmingRemove(false);
          }}
        />
      ) : null}
    </SidebarSection>
  );
}
