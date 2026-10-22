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
 * notification id is rejected server-side). Per-item mode buttons are gone
 * (R3.2): mode is chosen at send time.
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
    <div className="space-y-4">
      <QueueSection
        label="Up next"
        items={followUps}
        conversationId={conversationId}
        busy={busy}
        onBusyChange={setBusy}
      />
      <QueueSection
        label="Will steer"
        items={steers}
        conversationId={conversationId}
        busy={busy}
        onBusyChange={setBusy}
      />
    </div>
  );
}

function QueueSection({
  label,
  items,
  conversationId,
  busy,
  onBusyChange,
}: {
  label: string;
  items: readonly QueuedMessage[];
  conversationId?: string;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={label} className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h3>
      <ul aria-label={`${label} messages`} className="space-y-2">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.li key={item.id} {...rise} transition={gentle} className="space-y-1">
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
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
