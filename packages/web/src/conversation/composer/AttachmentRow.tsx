import { FileTextIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageThumbnail } from "@/components/ui/image-thumbnail";
import { type FileAttachment, formatFileSize } from "../files/attachments";
import { type Attachment, imageSrc } from "../images/attachments";

export function AttachmentRow({
  attachments,
  onRemove,
  files = [],
  onRemoveFile,
  disabled = false,
}: {
  attachments: readonly Attachment[];
  onRemove(id: number): void;
  files?: readonly FileAttachment[];
  onRemoveFile?(id: number): void;
  disabled?: boolean;
}) {
  if (attachments.length === 0 && files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-1 pt-1">
      {attachments.length > 0 ? (
        <ul aria-label="Attached images" className="flex flex-wrap gap-2">
          {attachments.map((item, index) => (
            <li key={item.id}>
              <ImageThumbnail
                src={imageSrc(item.image)}
                alt={`Attachment ${index + 1}`}
                onRemove={disabled ? undefined : () => onRemove(item.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {files.length > 0 ? (
        <ul aria-label="Attached files" className="flex flex-wrap gap-2">
          {files.map((item) => (
            <li key={item.id}>
              <span className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border bg-muted py-0.5 pr-1 pl-2 text-xs">
                <FileTextIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={item.ref.name}>
                  {item.ref.name}
                </span>
                <Badge variant="secondary">{formatFileSize(item.ref.size)}</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${item.ref.name}`}
                  disabled={disabled}
                  onClick={() => onRemoveFile?.(item.id)}
                >
                  <XIcon />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
