import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@tau/protocol";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
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
import { PathInput } from "@/components/ui/path-input";
import { homeRelative } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { useOnNode } from "@/nodes/use-on-node";

/** Mount it only while open so its field resets each time. */
export function ChangeFolderDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const api = useApi();
  const onNode = useOnNode();
  const pathId = useId();
  const [path, setPath] = useState("");
  const queryClient = useQueryClient();
  const { run, error, pending } = useSubmit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const changed = await run(async () => {
      await api.projects.setFolder(project.id, path.trim());
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations(project.id) });
    });
    if (!changed) return;
    toast.success(`${project.name} now uses ${path.trim()}`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Change folder</DialogTitle>
            <DialogDescription>
              Point {project.name} at the same repository in another place, for example after you moved it.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Current folder: <span className="font-mono">{homeRelative(project.path)}</span>
          </p>
          <div className="flex flex-col gap-2">
            <label htmlFor={pathId} className="text-sm font-medium">
              New folder{onNode}
            </label>
            <PathInput
              id={pathId}
              value={path}
              onValueChange={setPath}
              placeholder="~/src/my-app"
              autoFocus
              aria-invalid={error ? true : undefined}
            />
            <FormError message={error} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || path.trim() === ""}>
              Change folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
