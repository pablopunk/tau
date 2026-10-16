import type { QueuedMessage } from "../model/live";
import { UserMessage } from "./UserMessage";

const MODE_LABELS: Record<QueuedMessage["mode"], string> = {
  steer: "Queued, will steer the agent",
  followUp: "Queued, will send when the agent is done",
};

export function QueuedMessages({ items }: { items: readonly QueuedMessage[] }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Queued messages" className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="space-y-1">
          <UserMessage text={item.text} pending />
          <p className="text-right text-xs text-muted-foreground">{MODE_LABELS[item.mode]}</p>
        </li>
      ))}
    </ul>
  );
}
