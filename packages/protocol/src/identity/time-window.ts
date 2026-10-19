import { REQUEST_WINDOW_MS } from "../node-link-routing";

/** Signed distance of a header's `ts` from our clock (positive: the sender is ahead). Shown as "clock skew". */
export const skewMs = (ts: number, now: number): number => ts - now;

/** `true` when `ts` is within ±`windowMs` of `now` (default ±120 s). */
export const withinWindow = (ts: number, now: number, windowMs: number = REQUEST_WINDOW_MS): boolean =>
  Number.isFinite(ts) && Math.abs(ts - now) <= windowMs;
