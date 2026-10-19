import type { WorkspaceMode } from "@tau/protocol";
import { FolderIcon, GitBranchIcon, type LucideIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProjects, useSettings } from "@/lib/queries";

export interface WorktreeToggleProps {
  projectId: string;
  value: WorkspaceMode | null;
  onChange(mode: WorkspaceMode): void;
  disabled?: boolean;
}

function ModeItem({ value, label, icon: Icon }: { value: WorkspaceMode; label: string; icon: LucideIcon }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToggleGroupItem value={value} aria-label={label}>
          <Icon />
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function WorktreeToggle({ projectId, value, onChange, disabled }: WorktreeToggleProps) {
  const project = useProjects().data?.find((candidate) => candidate.id === projectId);
  const setting = useSettings().data?.workspaceDefault ?? "per-project";
  const defaultMode = setting === "per-project" ? (project?.lastWorkspaceMode ?? "worktree") : setting;
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
      <ModeItem value="worktree" label="Worktree" icon={GitBranchIcon} />
      <ModeItem value="checkout" label="Main checkout" icon={FolderIcon} />
    </ToggleGroup>
  );
}
