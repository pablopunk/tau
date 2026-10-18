import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@tau/protocol";
import { useId } from "react";
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
import { DropZone } from "@/components/ui/drop-zone";
import { ImageThumbnail } from "@/components/ui/image-thumbnail";
import { Input } from "@/components/ui/input";
import { ProjectIcon } from "@/components/ui/project-icon";
import { api } from "@/lib/api";
import { queryKeys, useIconCandidates } from "@/lib/queries";
import { renderIconPng } from "./render-icon-png";

const MAX_CANDIDATES = 12;

const fetchBlob = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load that image.");
  return response.blob();
};

/** Mount it only while open so its state resets each time. */
export function ChangeIconDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const inputId = useId();
  const queryClient = useQueryClient();
  const { run, error, pending } = useSubmit();
  const candidates = useIconCandidates(project.id);

  const finish = async (change: () => Promise<void>) => {
    const done = await run(async () => {
      await change();
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    });
    if (done) onClose();
  };
  const choose = (source: () => Promise<Blob>) =>
    finish(async () => api.projects.setIcon(project.id, await renderIconPng(await source())));
  const chooseFiles = (files: File[]) => {
    const file = files.find((candidate) => candidate.type.startsWith("image/"));
    if (file) void choose(async () => file);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change icon for {project.name}</DialogTitle>
          <DialogDescription>Pick an image from the project or upload your own.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <ProjectIcon id={project.id} name={project.name} iconUrl={project.iconUrl} tile={48} />
          <DropZone onFiles={chooseFiles} disabled={pending} label="Drop an image" className="flex-1">
            <label htmlFor={inputId} className="sr-only">
              Upload an image
            </label>
            <Input
              id={inputId}
              type="file"
              accept="image/*"
              disabled={pending}
              onChange={(event) => {
                chooseFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </DropZone>
        </div>
        {candidates.data && candidates.data.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {candidates.data.slice(0, MAX_CANDIDATES).map((candidate) => (
              <ImageThumbnail
                key={candidate.name}
                src={candidate.url}
                alt={candidate.name}
                onOpen={() => void choose(() => fetchBlob(candidate.url))}
              />
            ))}
          </div>
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void finish(() => api.projects.resetIcon(project.id))}
          >
            Reset to default
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
