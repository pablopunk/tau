import type { ConversationSummary, Project } from "@pi-everywhere/protocol";

export const isArchived = (conversation: ConversationSummary): boolean => conversation.archivedAt !== null;

export const activeThreads = (all: readonly ConversationSummary[]) =>
  all.filter((conversation) => !isArchived(conversation));

export const archivedThreads = (all: readonly ConversationSummary[]) => all.filter(isArchived);

export interface ProjectSection {
  project: Project;
  active: ConversationSummary[];
  archived: ConversationSummary[];
}

const newestActivity = (section: ProjectSection) => section.active[0]?.lastActivityAt ?? 0;

const hasActiveThreads = (section: ProjectSection) =>
  section.project.status === "ready" && section.active.length > 0;

export function projectSections(
  projects: readonly Project[],
  conversations: readonly ConversationSummary[],
): ProjectSection[] {
  const sections = projects.map((project) => {
    const own = conversations.filter((conversation) => conversation.projectId === project.id);
    return { project, active: activeThreads(own), archived: archivedThreads(own) };
  });
  const busy = sections.filter(hasActiveThreads).sort((a, b) => newestActivity(b) - newestActivity(a));
  return [...busy, ...sections.filter((section) => !hasActiveThreads(section))];
}

export const homeRelative = (path: string): string => path.replace(/^(\/Users|\/home)\/[^/]+/, "~");
