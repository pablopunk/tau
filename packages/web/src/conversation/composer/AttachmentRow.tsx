import { ImageThumbnail } from "@/components/ui/image-thumbnail";
import { type Attachment, imageSrc } from "../images/attachments";

export function AttachmentRow({
  attachments,
  onRemove,
}: {
  attachments: readonly Attachment[];
  onRemove(id: number): void;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Attached images" className="flex flex-wrap gap-2 px-1 pt-1">
      {attachments.map((item, index) => (
        <li key={item.id}>
          <ImageThumbnail
            src={imageSrc(item.image)}
            alt={`Attachment ${index + 1}`}
            onRemove={() => onRemove(item.id)}
          />
        </li>
      ))}
    </ul>
  );
}
