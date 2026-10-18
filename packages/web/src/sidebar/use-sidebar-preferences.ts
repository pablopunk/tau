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

export function useProjectOpenOverrides() {
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() =>
    preferences.getProjectOpenOverrides(),
  );
  const setOpen = (projectId: string, open: boolean) => {
    const next = { ...overrides, [projectId]: open };
    preferences.setProjectOpenOverrides(next);
    setOverrides(next);
  };
  return { overrides, setOpen };
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
