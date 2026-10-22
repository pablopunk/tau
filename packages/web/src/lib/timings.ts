/**
 * Client-side action timings for the queue-remake measurement track.
 *
 * Every user action is traced tap → confirm → live-reflect, joined on the
 * correlation ids the R3.6 receipts return (`submissionId`, `entryId?`) plus
 * the client `requestId`. The server logs the stages it owns (admission, gate
 * wait, abort start/end, run start, notification delivery) keyed the same way;
 * E2E joins both sides by `submissionId` into the baseline JSON.
 *
 * Boring on purpose: `performance.now()` marks, `console.debug` lines and a
 * devtools-only `window.__tauTimings` ring (last 200) behind `?timings=1`.
 * No storage, no design-system cost.
 */

export type TimingStage = "tap" | "confirm" | "reflect";

export interface TimingMark {
  /** Stable action name: `send`, `queue-send-now`, `queue-cancel`, `queue-stop`, `threads-archive`, … */
  readonly action: string;
  readonly stage: TimingStage;
  /** `performance.now()` instant of the mark. */
  readonly at: number;
  readonly requestId?: string | undefined;
  readonly submissionId?: number | undefined;
  readonly entryId?: number | undefined;
  readonly note?: string | undefined;
}

export interface TimingSpan {
  readonly action: string;
  readonly requestId?: string | undefined;
  readonly submissionId?: number | undefined;
  readonly entryId?: number | undefined;
  /** Tap → server confirmed (REST 200 + receipt). */
  readonly confirmMs?: number | undefined;
  /** Tap → live state reflects the action (row moved, bubble swapped). */
  readonly reflectMs?: number | undefined;
}

const RING_SIZE = 200;

const ring: TimingMark[] = [];
const pending = new Map<string, number>();

function keyOf(action: string, requestId?: string): string {
  return requestId === undefined ? action : `${action}:${requestId}`;
}

function emit(mark: TimingMark): void {
  ring.push(mark);
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
  console.debug(`[timings] ${mark.action} ${mark.stage} ${Math.round(mark.at)}ms`, {
    ...(mark.submissionId !== undefined && { submissionId: mark.submissionId }),
    ...(mark.entryId !== undefined && { entryId: mark.entryId }),
    ...(mark.note !== undefined && { note: mark.note }),
  });
  const store = (globalThis as { __tauTimings?: TimingMark[] }).__tauTimings;
  if (Array.isArray(store)) {
    store.push(mark);
    if (store.length > RING_SIZE) store.splice(0, store.length - RING_SIZE);
  }
}

/** T1 point: the user tapped. Returns the token `markConfirm` needs. */
export function markAction(action: string, requestId?: string): string {
  const token = keyOf(action, requestId);
  pending.set(token, performance.now());
  emit({ action, stage: "tap", at: performance.now(), requestId });
  return token;
}

/** The server confirmed: REST 200 with a receipt. `renderMs = clientMs − serverMs` falls out downstream. */
export function markConfirm(
  token: string,
  receipt: { submissionId?: number | undefined; entryId?: number | undefined },
  note?: string,
): void {
  const started = pending.get(token);
  const at = performance.now();
  const [action] = token.split(":");
  emit({
    action: action ?? token,
    stage: "confirm",
    at,
    submissionId: receipt.submissionId,
    entryId: receipt.entryId,
    ...(note !== undefined && { note }),
  });
  if (started !== undefined) pending.set(token, started);
}

/** Live state reflects the action: row moved, pending bubble swapped, composer restored. */
export function markLiveReflect(
  action: string,
  receipt: { submissionId?: number | undefined; entryId?: number | undefined },
  tapToken?: string,
): void {
  const at = performance.now();
  emit({ action, stage: "reflect", at, submissionId: receipt.submissionId, entryId: receipt.entryId });
  if (tapToken !== undefined) pending.delete(tapToken);
}

/** Last-200 ring snapshot for the `?timings=1` overlay and unit tests. */
export function timingMarks(): readonly TimingMark[] {
  return [...ring];
}

/** Joins tap/confirm/reflect marks into per-action spans for the baseline artifact. */
export function timingSpans(): TimingSpan[] {
  const taps = new Map<string, TimingMark>();
  const spans = new Map<string, TimingSpan>();
  for (const mark of ring) {
    const id = keyOf(mark.action, undefined);
    if (mark.stage === "tap") {
      taps.set(id, mark);
      spans.set(id, { action: mark.action });
    } else if (mark.stage === "confirm") {
      const tap = taps.get(id);
      const span = spans.get(id) ?? { action: mark.action };
      spans.set(id, {
        ...span,
        submissionId: mark.submissionId,
        entryId: mark.entryId,
        ...(tap !== undefined && { confirmMs: mark.at - tap.at }),
      });
    } else {
      const tap = taps.get(id);
      const span = spans.get(id) ?? { action: mark.action };
      spans.set(id, {
        ...span,
        submissionId: mark.submissionId ?? span.submissionId,
        entryId: mark.entryId ?? span.entryId,
        ...(tap !== undefined && { reflectMs: mark.at - tap.at }),
      });
    }
  }
  return [...spans.values()];
}

/** Test-only reset. */
export function clearTimings(): void {
  ring.length = 0;
  pending.clear();
}
