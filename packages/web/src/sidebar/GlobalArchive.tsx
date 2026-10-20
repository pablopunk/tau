import { useQueryClient } from "@tanstack/react-query";
import type { ConversationSummary } from "@tau/protocol";
import { ArchiveIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/queries";
import { apiOfNode, type NodeData, useNodesData } from "@/nodes";

interface ArchiveButtonProps {
  show: boolean;
  onToggle: () => void;
}

const archivedOf = (node: NodeData): ConversationSummary[] =>
  node.conversations.filter((conversation) => conversation.archivedAt !== null);

const countOf = (nodes: readonly NodeData[]): number =>
  nodes.reduce((total, node) => total + archivedOf(node).length, 0);

/** The global archive toggle: shows archived threads inline in the sidebar, in their normal order. */
export function ArchiveButton({ show, onToggle }: ArchiveButtonProps) {
  const nodes = useNodesData();
  const count = countOf(nodes);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="relative shrink-0 aria-pressed:bg-sidebar-accent aria-pressed:text-foreground"
      aria-label={
        count === 0
          ? "Show archived threads"
          : show
            ? `Hide archived threads, ${count}`
            : `Show archived threads, ${count}`
      }
      aria-pressed={show}
      title={show ? "Hide archived threads" : "Show archived threads"}
      onClick={onToggle}
    >
      <ArchiveIcon />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-medium text-primary-foreground"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Button>
  );
}

function DeleteAllConfirm({ onClose }: { onClose: () => void }) {
  const nodes = useNodesData();
  const queryClient = useQueryClient();
  const [force, setForce] = useState(false);
  const [pending, setPending] = useState(false);
  const withArchived = nodes
    .map((node) => ({ node, archived: archivedOf(node) }))
    .filter(({ archived }) => archived.length > 0);
  const unmerged = withArchived.flatMap(({ node, archived }) =>
    archived.filter((thread) => thread.unmergedWarning !== null).map((thread) => ({ node, thread })),
  );
  const deleting = withArchived.reduce(
    (total, { archived }) =>
      total + (force ? archived.length : archived.filter((thread) => thread.unmergedWarning === null).length),
    0,
  );

  const confirm = async () => {
    setPending(true);
    let deleted = 0;
    let kept = 0;
    try {
      for (const { node } of withArchived) {
        const result = await apiOfNode(node.nodeId).conversations.deleteArchived({ force });
        deleted += result.deleted.length;
        kept += result.kept.length;
      }
      if (kept === 0) toast.success(`Deleted ${deleted} archived thread${deleted === 1 ? "" : "s"}`);
      else toast.info(`Deleted ${deleted}, kept ${kept}`);
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
      onClose();
      const remoteIds = withArchived
        .map(({ node }) => node.nodeId)
        .filter((id) => id !== undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        ...remoteIds.map((id) => queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(id) })),
      ]);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete all archived?</DialogTitle>
          <DialogDescription>
            {deleting} archived thread{deleting === 1 ? "" : "s"} will be deleted with{" "}
            {deleting === 1 ? "its" : "their"} worktrees and branches.
          </DialogDescription>
        </DialogHeader>
        {unmerged.length > 0 && !force && (
          <div className="text-sm">
            <p>Kept because of unmerged work ({unmerged.length}):</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {unmerged.map(({ node, thread }) => (
                <li key={thread.id}>
                  {thread.title}
                  {node.local ? "" : ` (${node.name})`}: {thread.unmergedWarning}
                </li>
              ))}
            </ul>
          </div>
        )}
        {unmerged.length > 0 && (
          <Label>
            <Checkbox checked={force} onCheckedChange={(checked) => setForce(checked === true)} />
            Also delete threads with unmerged work
          </Label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => void confirm()}>
            Delete {deleting}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Deletes every archived thread on every node. Only rendered while the archive toggle is on. */
export function DeleteAllArchivedButton() {
  const nodes = useNodesData();
  const [confirming, setConfirming] = useState(false);
  if (countOf(nodes) === 0) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        aria-label="Delete all archived"
        title="Delete all archived"
        onClick={() => setConfirming(true)}
      >
        <Trash2Icon />
      </Button>
      {confirming && <DeleteAllConfirm onClose={() => setConfirming(false)} />}
    </>
  );
}
