export const TICK_MS = 5000;
/** 12 unchanged ticks of 5 s: 60 s without a heartbeat. */
export const STALL_TICKS = 12;
/** A gap above this between two ticks means the process or the machine was paused (sleep). */
export const SLEEP_GAP_MS = 10_000;

export interface WatchdogLoopOptions {
  readonly readCounter: () => number;
  /** A monotonic clock in ms. */
  readonly now: () => number;
  readonly onStall: (detail: string) => void;
  readonly stallTicks?: number;
  readonly sleepGapMs?: number;
}

/**
 * Called every tick. The counter is bumped by the main thread every second; a counter that does not move for
 * `stallTicks` ticks in a row is a hang. A gap between ticks above `sleepGapMs` (sleep, SIGSTOP) resets the count,
 * so a woken machine gets a full window to beat again before anything is killed.
 */
export function createWatchdogLoop(options: WatchdogLoopOptions): { tick(): void } {
  const stallTicks = options.stallTicks ?? STALL_TICKS;
  const sleepGapMs = options.sleepGapMs ?? SLEEP_GAP_MS;
  let lastCounter = options.readCounter();
  let lastTickAt = options.now();
  let unchanged = 0;
  return {
    tick() {
      const at = options.now();
      const counter = options.readCounter();
      const slept = at - lastTickAt > sleepGapMs;
      lastTickAt = at;
      if (slept || counter !== lastCounter) unchanged = 0;
      else unchanged += 1;
      lastCounter = counter;
      if (unchanged >= stallTicks) options.onStall(`no heartbeat for ${unchanged} checks`);
    },
  };
}
