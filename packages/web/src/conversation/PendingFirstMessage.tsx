import type { FirstMessage } from "@/routes/first-message";
import { UserMessage } from "./messages/UserMessage";

export function PendingFirstMessage({ message }: { message: FirstMessage }) {
  const text = [message.text, ...(message.files ?? []).map((file) => `Attached file: "${file.path}"`)]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="space-y-1">
      <UserMessage
        text={text}
        images={message.images.map((image) => ({ type: "image" as const, ...image }))}
        pending
      />
      <div className="flex items-center justify-end gap-2">
        <p role="status" className="text-xs text-muted-foreground">
          Sending…
        </p>
      </div>
    </div>
  );
}
