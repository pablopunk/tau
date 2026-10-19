/** An announce's order: `boot` (persisted at boot only) then `counter` (in memory, from 0). Lexicographic. */
export interface Sequence {
  readonly boot: number;
  readonly counter: number;
}

export function compareSequence(a: Sequence, b: Sequence): number {
  return a.boot !== b.boot ? Math.sign(a.boot - b.boot) : Math.sign(a.counter - b.counter);
}

/** A record that is not strictly newer is dropped. `current` undefined means nothing known: anything is newer. */
export const isNewerSequence = (candidate: Sequence, current: Sequence | undefined): boolean =>
  current === undefined || compareSequence(candidate, current) > 0;

/** `boot = max(lastBoot + 1, now)`: a clock set back still moves forward. */
export const nextBoot = (lastBoot: number, now: number): number => Math.max(lastBoot + 1, now);
