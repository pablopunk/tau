import { defineDocFamily } from "@earendil-works/pi-durable";
import type { Timer } from "@tau/protocol";

export type TimerRecord = Timer & {
  /** The request id of the last `app.timer_fired` input; while it is still queued, the next fire is coalesced. */
  lastFireRequestId: string | null;
};

/** Keyed by project id, so timer writes never touch the conversation index. */
export const ProjectTimersDoc = defineDocFamily<{ timers: TimerRecord[] }, null>({
  kind: "app.project-timers",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ timers: [] }),
});

export const TIMERS_SEED = null;

export const toTimer = ({ lastFireRequestId: _ignored, ...timer }: TimerRecord): Timer => ({ ...timer });
