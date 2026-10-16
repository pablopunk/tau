import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";

/** Mount it only while open so its fields reset each time. */
export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const pathId = useId();
  const nameId = useId();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const { run, error, pending } = useSubmit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const added = await run(async () => {
      const trimmedName = name.trim();
      await api.projects.add({ path: path.trim(), ...(trimmedName ? { name: trimmedName } : {}) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    });
    if (added) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add project</DialogTitle>
            <DialogDescription>Pick a folder on this computer for the agent to work in.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label htmlFor={pathId} className="text-sm font-medium">
              Folder path
            </label>
            <Input
              id={pathId}
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/Users/you/src/my-app"
              spellCheck={false}
              autoFocus
              aria-invalid={error ? true : undefined}
            />
            <FormError message={error} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={nameId} className="text-sm font-medium">
              Name <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || path.trim() === ""}>
              Add project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
