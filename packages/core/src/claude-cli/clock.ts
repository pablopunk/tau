export interface ClaudeCliClock {
  now(): number;
  /** Returns the cancel function. */
  setTimer(run: () => void, delayMs: number): () => void;
}

export const systemClaudeCliClock: ClaudeCliClock = {
  now: () => Date.now(),
  setTimer(run, delayMs) {
    const handle = setTimeout(run, delayMs);
    handle.unref();
    return () => clearTimeout(handle);
  },
};
