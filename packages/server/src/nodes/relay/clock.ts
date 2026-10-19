/** `TAU_FAKE_CLOCK_OFFSET_MS` moves this node's clock for routed headers only (Phase 0 pin r7; tests and e2e). */
export function clockOffsetMs(env: NodeJS.ProcessEnv = process.env): number {
  const offset = Number(env.TAU_FAKE_CLOCK_OFFSET_MS);
  return Number.isFinite(offset) ? offset : 0;
}

export const skewedClock = (now: () => number, offset: number = clockOffsetMs()): (() => number) => {
  return () => now() + offset;
};
