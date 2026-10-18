import type { Project } from "@tau/protocol";
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

interface RemoveProjectDialogProps {
  project: Project;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function RemoveProjectDialog({ project, onConfirm, onClose }: RemoveProjectDialogProps) {
  const { run, error, pending } = useSubmit();
  const confirm = async () => {
    if (await run(onConfirm)) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {project.name}?</DialogTitle>
          <DialogDescription>
            The project and its conversations disappear from tau. Files in {project.path} stay untouched.
          </DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={confirm}>
            Remove project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
