import { ExternalLinkIcon, GitPullRequestIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAllConversations } from "@/lib/queries";
import { useWorkspaceActions } from "@/workspaces/use-workspace-actions";
import { SidebarSection } from "./SidebarSection";

export function PullRequestSection({ conversationId }: { conversationId: string }) {
  const thread = useAllConversations().data?.find((summary) => summary.id === conversationId);
  const workspace = thread?.workspace;
  const actions = useWorkspaceActions(conversationId);
  if (!workspace || workspace.mode !== "worktree" || workspace.state === "removed") return null;
  if (!workspace.pullRequestUrl) {
    return (
      <SidebarSection title="Pull request">
        <p className="text-xs text-muted-foreground">No pull request yet for this worktree.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={actions.pending}
          onClick={actions.createPullRequest}
        >
          Create PR
        </Button>
      </SidebarSection>
    );
  }
  return (
    <SidebarSection title="Pull request">
      <a
        href={workspace.pullRequestUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
      >
        <GitPullRequestIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">Open pull request</span>
        <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </a>
    </SidebarSection>
  );
}
