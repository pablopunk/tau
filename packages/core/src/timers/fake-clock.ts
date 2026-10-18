import type { SchedulerClock } from "./scheduler-api";

export interface FakeClock extends SchedulerClock {
  /** Moves time forward and fires every due timer in order, awaiting nothing. */
  advance(ms: number): void;
  pending(): number;
}

export function createFakeClock(start = 0): FakeClock {
  let current = start;
  let timers: { at: number; callback: () => void; cancelled: boolean }[] = [];
  return {
    now: () => current,
    setTimer(callback, delayMs) {
      const timer = { at: current + delayMs, callback, cancelled: false };
      timers.push(timer);
      return {
        cancel() {
          timer.cancelled = true;
        },
      };
    },
    advance(ms) {
      const target = current + ms;
      for (;;) {
        timers = timers.filter((timer) => !timer.cancelled);
        const next = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((timer) => timer !== next);
        current = Math.max(current, next.at);
        next.callback();
      }
      current = target;
    },
    pending: () => timers.filter((timer) => !timer.cancelled).length,
  };
}
