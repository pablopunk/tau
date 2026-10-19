import { isNotificationText, type QueuedMessage } from "@tau/protocol";
import { QueuedNotificationRow } from "../notifications/QueuedNotificationRow";
import { QueuedItemActions } from "../queue/QueuedItemActions";
import { UserMessage } from "./UserMessage";

const MODE_LABELS: Record<QueuedMessage["mode"], string | null> = {
  steer: null,
  followUp: "Will send when the agent is done",
};

export function QueuedMessages({
  items,
  conversationId,
}: {
  items: readonly QueuedMessage[];
  conversationId?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Queued messages" className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="space-y-1">
          {isNotificationText(item.text) ? (
            <QueuedNotificationRow text={item.text} />
          ) : (
            <UserMessage text={item.text} images={item.images} pending />
          )}
          <div className="flex items-center justify-end gap-2">
            {MODE_LABELS[item.mode] ? (
              <p className="text-xs text-muted-foreground">{MODE_LABELS[item.mode]}</p>
            ) : null}
            {conversationId ? <QueuedItemActions conversationId={conversationId} item={item} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
