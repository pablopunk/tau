import { useState } from "react";
import { preferences, type SidebarMode } from "@/lib/preferences";
import { useMachineId } from "@/machines/machine-context";

export function useSidebarMode() {
  const [mode, setMode] = useState<SidebarMode>(() => preferences.getSidebarMode());
  const change = (next: SidebarMode) => {
    preferences.setSidebarMode(next);
    setMode(next);
  };
  return [mode, change] as const;
}

export function useProjectOpenOverrides() {
  const machineId = useMachineId();
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() =>
    preferences.getProjectOpenOverrides(machineId),
  );
  const setOpen = (projectId: string, open: boolean) => {
    const next = { ...overrides, [projectId]: open };
    preferences.setProjectOpenOverrides(next, machineId);
    setOverrides(next);
  };
  return { overrides, setOpen };
}

export function useCollapsedThreads() {
  const machineId = useMachineId();
  const [collapsed, setCollapsed] = useState<string[]>(() => preferences.getCollapsedThreads(machineId));
  const toggle = (threadId: string) => {
    const next = collapsed.includes(threadId)
      ? collapsed.filter((id) => id !== threadId)
      : [...collapsed, threadId];
    preferences.setCollapsedThreads(next, machineId);
    setCollapsed(next);
  };
  return { isExpanded: (threadId: string) => !collapsed.includes(threadId), toggle };
}

/** Which machine groups are collapsed in the sidebar (global: the ids are the machines'). */
export function useCollapsedMachines() {
  const [collapsed, setCollapsed] = useState<string[]>(() => preferences.getCollapsedMachines());
  const setOpen = (machineKey: string, open: boolean) => {
    const next = open ? collapsed.filter((id) => id !== machineKey) : [...collapsed, machineKey];
    preferences.setCollapsedMachines(next);
    setCollapsed(next);
  };
  return { isOpen: (machineKey: string) => !collapsed.includes(machineKey), setOpen };
}
