export const SPLIT_DEFAULT = 50;
export const SPLIT_MIN = 20;
export const SPLIT_MAX = 80;
const KEY = "tau:pane-split";

export const clampSplit = (percent: number): number =>
  Number.isFinite(percent) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, percent)) : SPLIT_DEFAULT;

export function readSplit(): number {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === null ? SPLIT_DEFAULT : clampSplit(Number(stored));
  } catch {
    return SPLIT_DEFAULT;
  }
}

export function writeSplit(percent: number): void {
  try {
    window.localStorage.setItem(KEY, String(clampSplit(percent)));
  } catch {
    // Storage is unavailable: the split just does not persist.
  }
}
