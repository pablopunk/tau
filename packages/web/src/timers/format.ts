import type { Timer } from "@tau/protocol";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `now`, `in 4 min`, `in 2 h`, `in 3 d`. */
export function untilLabel(at: number, now: number): string {
  const remaining = at - now;
  if (remaining <= 0) return "now";
  if (remaining < MINUTE) return "in less than a minute";
  if (remaining < HOUR) return `in ${Math.round(remaining / MINUTE)} min`;
  if (remaining < DAY) return `in ${Math.round(remaining / HOUR)} h`;
  return `in ${Math.round(remaining / DAY)} d`;
}

export const scheduleLabel = (timer: Pick<Timer, "kind" | "every">): string =>
  timer.kind === "repeat" && timer.every !== null ? `every ${timer.every}` : "once";

export const firedLabel = (count: number): string => (count === 0 ? "not fired yet" : `fired ${count}×`);

export const nextWakeupLabel = (nextTimerAt: string | null, now: number): string =>
  nextTimerAt === null ? "Has a timer" : `Next wake-up ${untilLabel(Date.parse(nextTimerAt), now)}`;
