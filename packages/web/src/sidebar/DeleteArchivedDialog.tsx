import { useQueryClient } from "@tanstack/react-query";
import type { ConversationSummary } from "@tau/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

interface DeleteArchivedDialogProps {
  archived: readonly ConversationSummary[];
  onClose: () => void;
}

const plural = (count: number) => `${count} archived thread${count === 1 ? "" : "s"}`;

export function DeleteArchivedDialog({ archived, onClose }: DeleteArchivedDialogProps) {
  const queryClient = useQueryClient();
  const { run, error, pending } = useSubmit();
  const [force, setForce] = useState(false);
  const unmerged = archived.filter((thread) => thread.unmergedWarning !== null);
  const deleting = force ? archived.length : archived.length - unmerged.length;

  const confirm = async () => {
    const deleted = await run(async () => {
      await api.conversations.deleteArchived({ force });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    });
    if (deleted) onClose();
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete all archived?</AlertDialogTitle>
          <AlertDialogDescription>
            {plural(deleting)} will be deleted with their worktrees and branches.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {unmerged.length > 0 && !force && (
          <div className="text-sm">
            <p>Kept because of unmerged work ({unmerged.length}):</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {unmerged.map((thread) => (
                <li key={thread.id}>
                  {thread.title}: {thread.unmergedWarning}
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
        <FormError message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            Delete {deleting}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
