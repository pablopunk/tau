import { useState } from "react";
import { preferences, type SidebarMode } from "@/lib/preferences";

export function useSidebarMode() {
  const [mode, setMode] = useState<SidebarMode>(() => preferences.getSidebarMode());
  const change = (next: SidebarMode) => {
    preferences.setSidebarMode(next);
    setMode(next);
  };
  return [mode, change] as const;
}

export function useClosedProjects() {
  const [closed, setClosed] = useState<string[]>(() => preferences.getClosedProjects());
  const setOpen = (projectId: string, open: boolean) => {
    const next = open ? closed.filter((id) => id !== projectId) : [...new Set([...closed, projectId])];
    preferences.setClosedProjects(next);
    setClosed(next);
  };
  return { closed, isOpen: (projectId: string) => !closed.includes(projectId), setOpen };
}

export function useCollapsedThreads() {
  const [collapsed, setCollapsed] = useState<string[]>(() => preferences.getCollapsedThreads());
  const toggle = (threadId: string) => {
    const next = collapsed.includes(threadId)
      ? collapsed.filter((id) => id !== threadId)
      : [...collapsed, threadId];
    preferences.setCollapsedThreads(next);
    setCollapsed(next);
  };
  return { isExpanded: (threadId: string) => !collapsed.includes(threadId), toggle };
}
