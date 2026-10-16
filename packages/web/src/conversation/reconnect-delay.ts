const FIRST_DELAY_MS = 500;
const MAX_DELAY_MS = 15_000;

export function reconnectDelayMs(attempt: number): number {
  return Math.min(MAX_DELAY_MS, FIRST_DELAY_MS * 2 ** attempt);
}
