import type { ConversationView } from "@tau/protocol";
import { useEffect } from "react";
import { ContextSection } from "./ContextSection";
import { GoalSection } from "./GoalSection";
import { ImagesSection } from "./ImagesSection";
import { MachineSection } from "./MachineSection";
import { ProcessesSection } from "./ProcessesSection";
import { PullRequestSection } from "./PullRequestSection";
import { type SidebarSectionId, sidebarSectionDomId } from "./sections";
import { TimersSection } from "./TimersSection";
import { TodosSection } from "./TodosSection";
import { WorktreeSection } from "./WorktreeSection";

/** The per-conversation right sidebar: images, worktree, machine, PRs, context, todos, timers, processes. */
export function ConversationSidebar({
  conversationId,
  view,
  reveal,
  onRevealed,
}: {
  conversationId: string;
  view: ConversationView;
  /** A section a collapsed-view indicator asked to jump to. */
  reveal?: SidebarSectionId | null;
  onRevealed?: () => void;
}) {
  useEffect(() => {
    if (!reveal) return;
    document.getElementById(sidebarSectionDomId(reveal))?.scrollIntoView({ block: "nearest" });
    onRevealed?.();
  }, [reveal, onRevealed]);
  return (
    <aside
      data-testid="conversation-sidebar"
      aria-label="Conversation details"
      className="hidden h-full w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l bg-muted/20 p-2 md:flex"
    >
      <WorktreeSection conversationId={conversationId} />
      <PullRequestSection conversationId={conversationId} />
      <MachineSection />
      <ContextSection view={view} />
      <ImagesSection view={view} />
      <GoalSection conversationId={conversationId} revealed={reveal === "goal"} />
      <TodosSection conversationId={conversationId} view={view} revealed={reveal === "todos"} />
      <TimersSection conversationId={conversationId} revealed={reveal === "timers"} />
      <ProcessesSection conversationId={conversationId} revealed={reveal === "processes"} />
    </aside>
  );
}
