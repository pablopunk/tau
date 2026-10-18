import type { ConversationSummary, Project } from "@tau/protocol";

export const isArchived = (conversation: ConversationSummary): boolean => conversation.archivedAt !== null;

export const activeThreads = (all: readonly ConversationSummary[]) =>
  all.filter((conversation) => !isArchived(conversation));

export const archivedThreads = (all: readonly ConversationSummary[]) => all.filter(isArchived);

export interface ThreadNode {
  conversation: ConversationSummary;
  children: ConversationSummary[];
}

export function nestThreads(conversations: readonly ConversationSummary[]): ThreadNode[] {
  const ids = new Set(conversations.map((conversation) => conversation.id));
  const isChild = (conversation: ConversationSummary) =>
    conversation.parentId !== null && ids.has(conversation.parentId);
  return conversations
    .filter((conversation) => !isChild(conversation))
    .map((conversation) => ({
      conversation,
      children: conversations.filter((child) => child.parentId === conversation.id),
    }));
}

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

export const projectIdFromPath = (pathname: string): string | undefined => {
  const encoded = /^\/p\/([^/]+)/.exec(pathname)?.[1];
  return encoded === undefined ? undefined : decodeURIComponent(encoded);
};

export function isProjectOpen(
  section: ProjectSection,
  overrides: Readonly<Record<string, boolean>>,
  currentProjectId: string | undefined,
): boolean {
  if (section.project.id === currentProjectId) return true;
  const isNotReady = section.project.status !== "ready";
  return overrides[section.project.id] ?? (isNotReady || section.active.length > 0);
}
