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
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function DeleteConversationDialog({ title, onConfirm, onClose }: DeleteConversationDialogProps) {
  const { run, error, pending } = useSubmit();
  const confirm = async () => {
    if (await run(onConfirm)) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {title}?</DialogTitle>
          <DialogDescription>
            The thread disappears from pi-everywhere. Its transcript stays on disk.
          </DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={confirm}>
            Delete thread
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
