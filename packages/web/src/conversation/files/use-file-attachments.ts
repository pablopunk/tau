import { useCallback, useState } from "react";
import { toast } from "sonner";
import { isUnknownRoute } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { useApi } from "@/nodes/node-context";
import {
  type FileAttachment,
  loadFileAttachments,
  newFileAttachment,
  saveFileAttachments,
} from "./attachments";

const UPDATE_NEEDED_MESSAGE = "This node needs an update to attach files.";

/**
 * Staged generic files: only `FileRef`s (`{name, path, size}`) are kept, never `File`, `Blob` or base64.
 * Each selection stages serially and appends against the latest store, so two overlapping
 * selections never clobber each other.
 */
export function useFileAttachments(target: string) {
  const api = useApi();
  const [files, setFiles] = useState<FileAttachment[]>(() => loadFileAttachments(target));
  const [staging, setStaging] = useState(0);

  const replace = useCallback(
    (next: FileAttachment[]) => {
      saveFileAttachments(target, next);
      setFiles(next);
    },
    [target],
  );

  const stageFiles = useCallback(
    async (selection: File[]) => {
      if (selection.length === 0) return;
      setStaging((count) => count + 1);
      try {
        for (const file of selection) {
          try {
            const ref = await api.uploads.stage(file);
            replace([...loadFileAttachments(target), newFileAttachment(ref)]);
          } catch (error) {
            // An older node has no stageUpload route: say so once instead of failing every file,
            // and never send a local path anywhere.
            if (isUnknownRoute(error)) {
              toast.error(UPDATE_NEEDED_MESSAGE);
              return;
            }
            toast.error(errorMessage(error));
          }
        }
      } finally {
        setStaging((count) => count - 1);
      }
    },
    [api, replace, target],
  );

  const remove = useCallback(
    (id: number) => replace(loadFileAttachments(target).filter((item) => item.id !== id)),
    [replace, target],
  );

  return { files, staging: staging > 0, stageFiles, remove, replace };
}
