import type { WorkspaceMode } from "@pi-everywhere/protocol";

export interface WorktreeToggleProps {
  projectId: string;
  value: WorkspaceMode | null;
  onChange(mode: WorkspaceMode): void;
  disabled?: boolean;
}

export function WorktreeToggle(_props: WorktreeToggleProps) {
  return null;
}
