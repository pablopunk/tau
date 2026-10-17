import type { WorkspaceStatus } from "@pi-everywhere/protocol";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RemoveWorktreeDialogProps {
  branch: string;
  status: WorkspaceStatus | undefined;
  pending: boolean;
  onConfirm(force: boolean): void;
  onClose(): void;
}

export function unmergedLines(status: WorkspaceStatus | undefined): string[] {
  if (!status) return [];
  const commits = status.unmergedCommits > 0 ? [`${status.unmergedCommits} unmerged commit(s)`] : [];
  return [...status.dirtyFiles, ...commits];
}

export function RemoveWorktreeDialog({
  branch,
  status,
  pending,
  onConfirm,
  onClose,
}: RemoveWorktreeDialogProps) {
  const lost = unmergedLines(status);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove worktree {branch}?</DialogTitle>
          <DialogDescription>
            The thread keeps working in the main checkout.
            {lost.length > 0 && " Removing the worktree loses this unmerged work:"}
          </DialogDescription>
        </DialogHeader>
        {lost.length > 0 && (
          <ul aria-label="Unmerged work" className="max-h-40 overflow-auto text-sm text-muted-foreground">
            {lost.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => onConfirm(lost.length > 0)}>
            Remove worktree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
