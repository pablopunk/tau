import { useState } from "react";
import { preferences, type SidebarMode } from "@/lib/preferences";
import { useNodeId } from "@/nodes/node-context";

export function useSidebarMode() {
  const [mode, setMode] = useState<SidebarMode>(() => preferences.getSidebarMode());
  const change = (next: SidebarMode) => {
    preferences.setSidebarMode(next);
    setMode(next);
  };
  return [mode, change] as const;
}

export function useProjectOpenOverrides() {
  const nodeId = useNodeId();
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() =>
    preferences.getProjectOpenOverrides(nodeId),
  );
  const setOpen = (projectId: string, open: boolean) => {
    const next = { ...overrides, [projectId]: open };
    preferences.setProjectOpenOverrides(next, nodeId);
    setOverrides(next);
  };
  return { overrides, setOpen };
}

export function useCollapsedThreads() {
  const nodeId = useNodeId();
  const [collapsed, setCollapsed] = useState<string[]>(() => preferences.getCollapsedThreads(nodeId));
  const toggle = (threadId: string) => {
    const next = collapsed.includes(threadId)
      ? collapsed.filter((id) => id !== threadId)
      : [...collapsed, threadId];
    preferences.setCollapsedThreads(next, nodeId);
    setCollapsed(next);
  };
  return { isExpanded: (threadId: string) => !collapsed.includes(threadId), toggle };
}

/** Which node groups are collapsed in the sidebar (global: the ids are the nodes'). */
export function useCollapsedNodes() {
  const [collapsed, setCollapsed] = useState<string[]>(() => preferences.getCollapsedNodes());
  const setOpen = (nodeKey: string, open: boolean) => {
    const next = open ? collapsed.filter((id) => id !== nodeKey) : [...collapsed, nodeKey];
    preferences.setCollapsedNodes(next);
    setCollapsed(next);
  };
  return { isOpen: (nodeKey: string) => !collapsed.includes(nodeKey), setOpen };
}
