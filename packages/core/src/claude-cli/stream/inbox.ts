import type { Binding } from "./binding";
import type { Turn } from "./turn";

/** Feeds the queued messages to the turn until its API message is complete; the rest stays queued. */
export function drainInbox(binding: Binding, turn: Turn): void {
  while (binding.inbox.length > 0 && !turn.isSettled()) {
    const next = binding.inbox.shift();
    if (next) turn.feed(next);
  }
}
