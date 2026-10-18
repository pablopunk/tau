import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import { readMeta } from "../harness/conversation-index";
import type { SchedulerClock } from "./scheduler-api";

/** What the timer tools need besides their own `api.commit`. */
export interface TimerToolServices {
  now(): number;
  /** Tells the web that the thread's timers changed. */
  announce(conversationId: string): Promise<void>;
}

export function createTimerToolServices(
  harness: Harness,
  clock: SchedulerClock,
  announce: (projectId: string, conversationId: string) => void,
): TimerToolServices {
  return {
    now: () => clock.now(),
    async announce(conversationId) {
      const meta = await readMeta(harness, Number(conversationId) as ConversationId);
      if (meta) announce(meta.projectId, conversationId);
    },
  };
}
