import { isNotificationText, type QueuedMessage } from "@tau/protocol";
import { AnimatePresence, gentle, motion, rise } from "@/components/ui/motion";
import { QueuedNotificationRow } from "../notifications/QueuedNotificationRow";
import { QueuedItemActions } from "../queue/QueuedItemActions";
import { UserMessage } from "./UserMessage";

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
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.li key={item.id} {...rise} transition={gentle} className="space-y-1">
            {isNotificationText(item.text) ? (
              <QueuedNotificationRow text={item.text} />
            ) : (
              <UserMessage text={item.text} images={item.images} pending />
            )}
            <div className="flex items-center justify-end gap-1">
              {conversationId ? (
                <QueuedItemActions
                  conversationId={conversationId}
                  item={item}
                  others={items.filter((other) => other.id !== item.id)}
                />
              ) : null}
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
