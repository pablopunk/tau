import type { Harness } from "@earendil-works/pi-durable";
import { type NotificationSubmitter, ThreadGoneError } from "../harness/notification-submitter";
import { BACKGROUND } from "../harness/open";
import { createKeyedScheduler } from "./keyed-scheduler";
import type { ClockTimer, Scheduler, SchedulerClock } from "./scheduler-api";
import {
  claimTimer,
  expiredNotice,
  settleFire,
  sweepGoneThreads,
  timerFiredNotification,
} from "./timer-fire";
import { removeTimersWhere, timerWithId } from "./timer-ops";
import { ProjectTimersDoc, type TimerRecord } from "./timers-doc";

export const TICK_MS = 30_000;
const MIN_REARM_MS = 1_000;

export interface TimerSchedulerDeps {
  readonly harness: Harness;
  readonly notifications: NotificationSubmitter;
  readonly clock: SchedulerClock;
  readonly projectIds: () => Promise<readonly string[]>;
  /** A thread's timers changed. */
  readonly announce: (projectId: string, conversationId: string) => void;
}

/** The durable timers on top of the keyed scheduler that owner D uses for check-ins. */
export interface TimerScheduler extends Scheduler {
  /** The first tick fires what was missed while tau was down (each timer at most once), then the ticks go on. */
  start(): Promise<void>;
  /** Runs one pass now; joins the pass in flight. */
  tick(): Promise<void>;
}

const logFailure = (what: string) => (error: unknown) => console.error(`tau: ${what} failed`, error);

export function createTimerScheduler(deps: TimerSchedulerDeps): TimerScheduler {
  const { harness, notifications, clock, announce } = deps;
  const keyed = createKeyedScheduler(clock);
  let closed = false;
  let armed: ClockTimer | undefined;
  let running: Promise<void> | undefined;

  async function noticeOnce(timer: TimerRecord) {
    await notifications.notify(timer.conversationId, expiredNotice(timer)).catch((error) => {
      if (!(error instanceof ThreadGoneError)) logFailure("a timer notice")(error);
    });
  }

  async function submitFire(projectId: string, timer: TimerRecord) {
    try {
      await notifications.notify(timer.conversationId, timerFiredNotification(timer));
    } catch (error) {
      if (!(error instanceof ThreadGoneError)) throw error;
      await harness.commit((tx) => removeTimersWhere(tx, projectId, timerWithId(timer.id)), BACKGROUND);
      announce(projectId, timer.conversationId);
      return false;
    }
    return true;
  }

  async function fireOne(projectId: string, timerId: string) {
    const claim = await claimTimer(harness, projectId, timerId, clock.now());
    if (claim.kind === "removed") {
      for (const id of claim.conversationIds) announce(projectId, id);
    } else if (claim.kind === "expired") {
      announce(projectId, claim.timer.conversationId);
      await noticeOnce(claim.timer);
    } else if (claim.kind === "coalesced") {
      announce(projectId, claim.conversationId);
    } else if (claim.kind === "fire" && (await submitFire(projectId, claim.timer))) {
      await settleFire(harness, projectId, claim.timer, clock.now());
      announce(projectId, claim.timer.conversationId);
    }
  }

  const isDue = (now: number) => (timer: TimerRecord) =>
    timer.nextAt <= now || (timer.expiresAt !== null && timer.expiresAt <= now);

  async function tickProject(projectId: string): Promise<number> {
    for (const id of await sweepGoneThreads(harness, projectId)) announce(projectId, id);
    const snapshot = await harness.snapshot(ProjectTimersDoc, projectId, BACKGROUND);
    const now = clock.now();
    for (const timer of (snapshot?.timers ?? []).filter(isDue(now))) {
      if (closed) break;
      await fireOne(projectId, timer.id).catch(logFailure("a timer fire"));
    }
    const rest = (await harness.snapshot(ProjectTimersDoc, projectId, BACKGROUND))?.timers ?? [];
    return Math.min(
      Number.POSITIVE_INFINITY,
      ...rest.map((timer) => Math.min(timer.nextAt, timer.expiresAt ?? Number.POSITIVE_INFINITY)),
    );
  }

  async function pass(): Promise<number> {
    let earliest = Number.POSITIVE_INFINITY;
    for (const projectId of await deps.projectIds()) {
      if (closed) break;
      earliest = Math.min(
        earliest,
        await tickProject(projectId).catch((error) => {
          logFailure("a timers pass")(error);
          return Number.POSITIVE_INFINITY;
        }),
      );
    }
    return earliest;
  }

  const delayUntil = (earliest: number) => Math.min(TICK_MS, Math.max(MIN_REARM_MS, earliest - clock.now()));

  function arm(delayMs: number) {
    armed?.cancel();
    armed = closed ? undefined : clock.setTimer(() => void tick(), delayMs);
  }

  function tick(): Promise<void> {
    if (running) return running;
    const current = pass()
      .then(delayUntil, (error) => {
        logFailure("a timers pass")(error);
        return TICK_MS;
      })
      .then(arm)
      .finally(() => {
        if (running === current) running = undefined;
      });
    running = current;
    return current;
  }

  return {
    scheduleAt: keyed.scheduleAt,
    cancel: keyed.cancel,
    start: tick,
    tick,
    async close() {
      closed = true;
      armed?.cancel();
      await running;
      await keyed.close();
    },
  };
}
