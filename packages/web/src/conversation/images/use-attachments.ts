import { useCallback, useState } from "react";
import { toast } from "sonner";
import { type Attachment, loadAttachments, newAttachment, roomLeft, saveAttachments } from "./attachments";
import { prepareImage } from "./prepare-image";

const NO_IMAGES_MESSAGE = "This model does not accept images.";

async function prepareAll(files: File[]): Promise<Attachment[]> {
  const prepared: Attachment[] = [];
  for (const file of files) {
    try {
      prepared.push(newAttachment(await prepareImage(file)));
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not add the image.");
    }
  }
  return prepared;
}

function imageFiles(files: File[]): File[] {
  return files.filter((file) => file.type.startsWith("image/"));
}

export function useAttachments(target: string, imagesAllowed: boolean) {
  const [attachments, setAttachments] = useState<Attachment[]>(() => loadAttachments(target));
  const [preparing, setPreparing] = useState(0);

  const replace = useCallback(
    (next: Attachment[]) => {
      saveAttachments(target, next);
      setAttachments(next);
    },
    [target],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      const images = imageFiles(files);
      if (images.length === 0) return;
      if (!imagesAllowed) return void toast.error(NO_IMAGES_MESSAGE);
      const room = roomLeft(loadAttachments(target));
      if (images.length > room) toast.error(`You can attach up to 8 images per message.`);
      setPreparing((count) => count + 1);
      const prepared = await prepareAll(images.slice(0, Math.max(0, room)));
      setPreparing((count) => count - 1);
      replace([...loadAttachments(target), ...prepared]);
    },
    [imagesAllowed, replace, target],
  );

  const remove = useCallback(
    (id: number) => replace(loadAttachments(target).filter((item) => item.id !== id)),
    [replace, target],
  );

  return { attachments, preparing: preparing > 0, addFiles, remove, replace };
}
