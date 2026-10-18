export interface ClockTimer {
  cancel(): void;
}

/** Injected so tests drive time by hand. `setTimer` must unref its timer so it never keeps the process alive. */
export interface SchedulerClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): ClockTimer;
}

export const systemClock: SchedulerClock = {
  now: Date.now,
  setTimer(callback, delayMs) {
    const handle = setTimeout(callback, Math.min(delayMs, MAX_TIMEOUT_MS));
    handle.unref();
    return { cancel: () => clearTimeout(handle) };
  },
};

/** Node clamps a timeout above 2^31 - 1 ms to 1 ms. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * What owner D (goals) calls for check-ins. Owner C's timer scheduler implements it in `core/src/timers/`.
 * Entries live in memory only: the caller re-arms them at startup from its own durable record.
 */
export interface Scheduler {
  /** Runs `run` once at `at` (epoch ms), or at the next tick when `at` has passed. A second call with the same key replaces the first. */
  scheduleAt(key: string, at: number, run: () => Promise<void>): void;
  /** A key that is not scheduled is ignored. */
  cancel(key: string): void;
  /** Cancels every entry and waits for runs in flight. Called before `harness.close()`. */
  close(): Promise<void>;
}
