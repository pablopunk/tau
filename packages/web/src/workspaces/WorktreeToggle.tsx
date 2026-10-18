import type { WorkspaceMode } from "@tau/protocol";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useProjects, useSettings } from "@/lib/queries";

export interface WorktreeToggleProps {
  projectId: string;
  value: WorkspaceMode | null;
  onChange(mode: WorkspaceMode): void;
  disabled?: boolean;
}

export function WorktreeToggle({ projectId, value, onChange, disabled }: WorktreeToggleProps) {
  const project = useProjects().data?.find((candidate) => candidate.id === projectId);
  const defaultMode = useSettings().data?.workspaceDefault ?? "worktree";
  if (!project?.isGitRepo) return null;
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={value ?? defaultMode}
      onValueChange={(next) => next && onChange(next as WorkspaceMode)}
      disabled={disabled}
      aria-label="Where the thread works"
    >
      <ToggleGroupItem value="worktree">Worktree</ToggleGroupItem>
      <ToggleGroupItem value="checkout">Main checkout</ToggleGroupItem>
    </ToggleGroup>
  );
}
