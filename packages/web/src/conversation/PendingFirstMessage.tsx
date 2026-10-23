import type { FirstMessage } from "@/routes/first-message";
import { UserMessage } from "./messages/UserMessage";

export function PendingFirstMessage({ message }: { message: FirstMessage }) {
  return (
    <div className="space-y-1">
      <UserMessage
        text={message.text}
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
