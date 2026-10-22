import { ExternalLinkIcon, GitPullRequestIcon } from "lucide-react";
import { useAllConversations } from "@/lib/queries";
import { SidebarSection } from "./SidebarSection";

export function PullRequestSection({ conversationId }: { conversationId: string }) {
  const thread = useAllConversations().data?.find((summary) => summary.id === conversationId);
  const workspace = thread?.workspace;
  if (workspace?.mode !== "worktree" || workspace.state === "removed") return null;
  // Creating a PR lives in the worktree section; here we only list an open one.
  if (!workspace.pullRequestUrl) return null;
  return (
    <SidebarSection sectionId="pull-request" title="Pull request">
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
