import type { QueuedMessage } from "@tau/protocol";
import { useState } from "react";
import { AnimatePresence, gentle, motion, rise } from "@/components/ui/motion";
import { QueuedNotificationRow } from "../notifications/QueuedNotificationRow";
import { QueuedItemActions } from "../queue/QueuedItemActions";
import { isUserItem } from "../queue/queued-mode";
import { UserMessage } from "./UserMessage";

/**
 * Inbox split: "Up next" (followUp) vs "Will steer" (steer). Cancel exists
 * only per user item; notification rows render with no action buttons —
 * nothing user-meaningful can be done with them (Cancel/Send-now on a
 * notification id is rejected server-side).
 *
 * One list, one `AnimatePresence`, stable keys: a Steer/Queue switch flips
 * the item's mode in place server-side, so React moves the same `motion.li`
 * within this list and `layout` slides it across sections instead of
 * unmounting it (no exit+enter flash). Never split sections into separate
 * animated lists: cross-parent moves always remount.
 */
export function QueuedMessages({
  items,
  conversationId,
}: {
  items: readonly QueuedMessage[];
  conversationId?: string;
}) {
  const [busy, setBusy] = useState(false);
  if (items.length === 0) return null;
  const followUps = items.filter((item) => item.mode === "followUp");
  const steers = items.filter((item) => item.mode !== "followUp");
  return (
    <section aria-label="Queued messages" className="space-y-2">
      <ul aria-label="Queued messages" className="space-y-2">
        <AnimatePresence initial={false}>
          {followUps.length > 0 ? <GroupHeading key="heading-followUp" label="Up next" /> : null}
          {followUps.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              conversationId={conversationId}
              busy={busy}
              onBusyChange={setBusy}
            />
          ))}
          {steers.length > 0 ? <GroupHeading key="heading-steer" label="Will steer" /> : null}
          {steers.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              conversationId={conversationId}
              busy={busy}
              onBusyChange={setBusy}
            />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

function GroupHeading({ label }: { label: string }) {
  return (
    <li className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h3>
    </li>
  );
}

function QueueRow({
  item,
  conversationId,
  busy,
  onBusyChange,
}: {
  item: QueuedMessage;
  conversationId?: string;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  return (
    <motion.li key={item.id} layout {...rise} transition={gentle} className="space-y-1">
      {isUserItem(item) ? (
        <UserMessage text={item.text} images={item.images} pending />
      ) : (
        <QueuedNotificationRow text={item.text} />
      )}
      {conversationId && isUserItem(item) ? (
        <div className="flex items-center justify-end gap-1">
          <QueuedItemActions
            conversationId={conversationId}
            item={item}
            busy={busy}
            onBusyChange={onBusyChange}
          />
        </div>
      ) : null}
    </motion.li>
  );
}
