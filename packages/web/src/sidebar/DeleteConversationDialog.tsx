import { isAppError } from "@tau/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeleteConversationDialogProps {
  title: string;
  onConfirm: (force: boolean) => Promise<void>;
  onClose: () => void;
}

const isUnmergedWorkError = (error: unknown) => isAppError(error) && error.code === "has_unmerged_work";

/** Unmerged work needs a second, explicit confirmation; after it the thread is deleted with its work. */
export function DeleteConversationDialog({ title, onConfirm, onClose }: DeleteConversationDialogProps) {
  const { run, error, pending } = useSubmit();
  const [unmergedWarning, setUnmergedWarning] = useState<string | null>(null);
  const force = unmergedWarning !== null;

  const deleteOrAskAgain = async () => {
    try {
      await onConfirm(force);
    } catch (caught) {
      if (force || !isUnmergedWorkError(caught)) throw caught;
      setUnmergedWarning(caught instanceof Error ? caught.message : String(caught));
      return;
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {title}?</DialogTitle>
          <DialogDescription>The thread disappears from tau. Its transcript stays on disk.</DialogDescription>
        </DialogHeader>
        <FormError
          message={unmergedWarning ? `${unmergedWarning}. Delete it anyway? This work is lost.` : null}
        />
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => run(deleteOrAskAgain)}>
            {force ? "Delete anyway" : "Delete thread"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
