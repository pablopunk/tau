import { AppError } from "@tau/protocol";

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

export const MIN_EVERY_MS = UNIT_MS.m;

/** "5m", "2h" or "1d" in milliseconds; `invalid_request` for anything else or under one minute. */
export function parseEvery(text: string): number {
  const match = /^(\d+)([mhd])$/.exec(text.trim());
  const interval = match ? Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS] : 0;
  if (interval < MIN_EVERY_MS) {
    throw new AppError("invalid_request", 'Use an interval like "5m", "2h" or "1d" (at least 1m).');
  }
  return interval;
}

export function describeDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / UNIT_MS.m));
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${Number(hours.toFixed(1))} h`;
  return `${Number((hours / 24).toFixed(1))} d`;
}

export const describeClockTime = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
