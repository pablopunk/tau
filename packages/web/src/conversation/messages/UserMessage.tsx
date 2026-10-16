import type { ImageContent } from "@pi-everywhere/protocol";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";
import { MessageImages } from "./MessageImages";

export interface UserMessageProps {
  text: string;
  images?: readonly ImageContent[];
  pending?: boolean;
}

export function UserMessage({ text, images = [], pending = false }: UserMessageProps) {
  return (
    <div className="group flex flex-col items-end gap-1.5">
      <MessageImages images={images} />
      {text ? (
        <div className="flex max-w-[85%] items-start gap-1">
          {pending ? null : <CopyButton text={text} label="Copy message" className="mt-1" />}
          <div
            className={cn(
              "rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-secondary-foreground",
              pending && "border border-dashed bg-transparent text-muted-foreground",
            )}
          >
            {text}
          </div>
        </div>
      ) : null}
    </div>
  );
}
