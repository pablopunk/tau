/**
 * Stage logging for the measurement track (PLAN-queue-remake, "Measurement track").
 *
 * Every line is a single greppable JSON object on `console.info` — deliberately
 * NOT pino/Fastify-logger (Fastify's logger is off by default; don't rely on
 * `request.log`). The CLI already mirrors console output into
 * `<home>/logs/server.log` with 10MB rotation, so retention exists and a full
 * action trace is `grep requestId|submissionId` on that file.
 *
 * Correlation reuses `requestId` + the `{submissionId, entryId?}` receipts —
 * no new ids. Budget: ~200B x ~6 stages per action; zero added network calls.
 */

export const TIMING_SOURCE = "tau-timing";

export interface TimingEvent {
  readonly action: string;
  readonly stage: string;
  readonly serverMs?: number;
  readonly gateWaitMs?: number;
  readonly conversationId?: string;
  readonly requestId?: string;
  readonly submissionId?: string;
  readonly entryId?: string;
}

/** Canonical server-owned stage names. Keep stable: e2e joins on these. */
export const STAGE = {
  admission: "admission",
  gateWait: "gate-wait",
  abortStart: "abort-start",
  abortEnd: "abort-end",
  admit: "admit",
  runStart: "run-start",
  exit: "exit",
  notificationDelivered: "notification-delivered",
  watchFailure: "watch-failure",
  heartbeatTimeout: "heartbeat-timeout",
} as const;

/** One greppable JSON line per stage. Never throws; never blocks. */
export function logStage(event: TimingEvent): void {
  console.info(JSON.stringify({ source: TIMING_SOURCE, t: Date.now(), ...event }));
}

/** Breakdown the Send-now path reports: gate-wait/abort/admit split. */
export interface SendNowBreakdown {
  readonly conversationId: string;
  readonly requestId?: string;
  readonly submissionId?: string;
  readonly gateWaitMs: number;
  readonly abortMs: number;
  readonly admitMs: number;
}

export function logSendNowBreakdown(breakdown: SendNowBreakdown): void {
  const { gateWaitMs, abortMs, admitMs, ...correlation } = breakdown;
  logStage({ action: "send-now", stage: STAGE.gateWait, serverMs: gateWaitMs, ...correlation });
  logStage({ action: "send-now", stage: "abort", serverMs: abortMs, ...correlation });
  logStage({ action: "send-now", stage: STAGE.admit, serverMs: admitMs, ...correlation });
}
