import type { ImageContent } from "@tau/protocol";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";
import { MessageImages } from "./MessageImages";
import { MessageMenu } from "./MessageMenu";
import type { MessageEntry } from "./message-actions";

export interface UserMessageProps {
  text: string;
  images?: readonly ImageContent[];
  pending?: boolean;
  entry?: MessageEntry;
}

export function UserMessage({ text, images = [], pending = false, entry }: UserMessageProps) {
  return (
    <div className="group flex flex-col items-end gap-1.5">
      <MessageImages images={images} />
      {text ? (
        // On small coarse screens the 44px actions would squeeze the bubble:
        // stack them in their own right-aligned row instead.
        <div className="flex max-w-[85%] items-start gap-1 max-sm:pointer-coarse:flex-col max-sm:pointer-coarse:items-end">
          <div className="flex shrink-0 items-center gap-0.5">
            {pending ? null : <CopyButton text={text} label="Copy message" className="mt-1" />}
            {entry ? <MessageMenu entry={entry} /> : null}
          </div>
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
