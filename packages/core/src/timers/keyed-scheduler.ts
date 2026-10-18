import type { ClockTimer, Scheduler, SchedulerClock } from "./scheduler-api";

const logFailure = (error: unknown) => console.error("tau: a scheduled run failed", error);

/** The in-memory part of the scheduler: one timer per key. Owner C builds the durable timers on top of the same clock. */
export function createKeyedScheduler(clock: SchedulerClock): Scheduler {
  const timers = new Map<string, ClockTimer>();
  const inFlight = new Set<Promise<void>>();
  let closed = false;

  const run = (key: string, task: () => Promise<void>) => {
    timers.delete(key);
    if (closed) return;
    const running = task()
      .catch(logFailure)
      .finally(() => inFlight.delete(running));
    inFlight.add(running);
  };

  const cancel = (key: string) => {
    timers.get(key)?.cancel();
    timers.delete(key);
  };

  return {
    scheduleAt(key, at, task) {
      if (closed) return;
      cancel(key);
      timers.set(
        key,
        clock.setTimer(() => run(key, task), Math.max(0, at - clock.now())),
      );
    },
    cancel,
    async close() {
      closed = true;
      for (const key of [...timers.keys()]) cancel(key);
      await Promise.all(inFlight);
    },
  };
}
