/** The sidebar sections a collapsed-view indicator can jump to. */
export type SidebarSectionId =
  | "worktree"
  | "pull-request"
  | "node"
  | "context"
  | "images"
  | "goal"
  | "todos"
  | "timers"
  | "processes";

export const sidebarSectionDomId = (section: SidebarSectionId): string => `conversation-sidebar-${section}`;
