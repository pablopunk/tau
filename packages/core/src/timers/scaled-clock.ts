import { type SchedulerClock, systemClock } from "./scheduler-api";

/** Test only: time runs `speed` times faster, so an e2e test can wait for a one-minute repeat in a second. */
export function scaledClock(speed: number, base: SchedulerClock = systemClock): SchedulerClock {
  const start = base.now();
  return {
    now: () => start + (base.now() - start) * speed,
    setTimer: (callback, delayMs) => base.setTimer(callback, delayMs / speed),
  };
}

export function clockFromEnvironment(env: Record<string, string | undefined>, faux: boolean): SchedulerClock {
  const speed = Number(env.TAU_TEST_TIMER_SPEED);
  return faux && Number.isFinite(speed) && speed > 1 ? scaledClock(speed) : systemClock;
}
