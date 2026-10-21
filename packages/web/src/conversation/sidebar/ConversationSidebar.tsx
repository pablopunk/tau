import type { ConversationView } from "@tau/protocol";
import { ContextSection } from "./ContextSection";
import { GoalTodosSection } from "./GoalTodosSection";
import { ImagesSection } from "./ImagesSection";
import { MachineSection } from "./MachineSection";
import { ProcessesSection } from "./ProcessesSection";
import { PullRequestSection } from "./PullRequestSection";
import { TimersSection } from "./TimersSection";
import { WorktreeSection } from "./WorktreeSection";

/** The per-conversation right sidebar: images, worktree, machine, PRs, context, todos, timers, processes. */
export function ConversationSidebar({
  conversationId,
  view,
}: {
  conversationId: string;
  view: ConversationView;
}) {
  return (
    <aside
      data-testid="conversation-sidebar"
      aria-label="Conversation details"
      className="flex h-full w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l bg-muted/20 p-2"
    >
      <WorktreeSection conversationId={conversationId} />
      <PullRequestSection conversationId={conversationId} />
      <MachineSection />
      <ContextSection view={view} />
      <ImagesSection view={view} />
      <GoalTodosSection conversationId={conversationId} view={view} />
      <TimersSection conversationId={conversationId} />
      <ProcessesSection conversationId={conversationId} />
    </aside>
  );
}
