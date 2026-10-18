import type { ConversationId } from "@earendil-works/pi-durable";
import { NOTICE_KIND, TIMER_FIRED_KIND } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  harnessNotificationSubmitter,
  type NotificationSubmitter,
  ThreadGoneError,
} from "../harness/notification-submitter";
import { BACKGROUND } from "../harness/open";
import { useTempDir } from "../test-support/temp-dir";
import { DAY, MINUTE, openTimersWorld, START, type TimersWorld, waitUntilIdle } from "./timer-test-support";

const tempDir = useTempDir();
let directory: string;
let world: TimersWorld;

beforeEach(async () => {
  directory = await tempDir();
  world = await openTimersWorld(directory);
});

afterEach(() => world.close());

async function idleThread(requestId = "r1") {
  const id = await world.startThread("hello", requestId);
  await waitUntilIdle(world);
  return id;
}

const firedCount = async (threadId: string) => (await world.entriesOfKind(threadId, TIMER_FIRED_KIND)).length;

async function waitForFired(threadId: string, expected: number) {
  await vi.waitFor(async () => expect(await firedCount(threadId)).toBe(expected), { timeout: 10_000 });
}

describe("timer scheduler", () => {
  it("fires a wake-up once when it is due, then removes it", async () => {
    const id = await idleThread();
    await world.add(id, { id: "w1", kind: "wakeup", every: null, nextAt: START + 10 * MINUTE });
    const scheduler = world.makeScheduler();
    await scheduler.start();
    world.clock.advance(9 * MINUTE);
    await scheduler.tick();
    expect(await world.timers()).toHaveLength(1);
    world.clock.advance(2 * MINUTE);
    await scheduler.tick();
    await waitForFired(id, 1);
    expect(await world.timers()).toEqual([]);
    expect(world.announced).toContain(id);
    await scheduler.close();
  });

  it("keeps a repeat on its schedule and counts the fires", async () => {
    const id = await idleThread();
    await world.add(id, { id: "r1", nextAt: START + 5 * MINUTE });
    const scheduler = world.makeScheduler();
    world.clock.advance(5 * MINUTE);
    await scheduler.tick();
    await waitForFired(id, 1);
    const [timer] = await world.timers();
    expect(timer).toMatchObject({
      firedCount: 1,
      nextAt: START + 10 * MINUTE,
      lastFireRequestId: "timer:r1:0",
    });
    await scheduler.close();
  });

  it("ticks every 30 seconds through the clock", async () => {
    const id = await idleThread();
    await world.add(id, { id: "r1", nextAt: START + MINUTE });
    const scheduler = world.makeScheduler();
    await scheduler.start();
    world.clock.advance(MINUTE);
    await scheduler.tick();
    await waitForFired(id, 1);
    expect(world.clock.pending()).toBe(1);
    await scheduler.close();
    expect(world.clock.pending()).toBe(0);
  });

  it("fires a one-shot missed while tau was down once at startup", async () => {
    const id = await idleThread();
    await world.add(id, { id: "w1", kind: "wakeup", every: null, nextAt: START + MINUTE });
    world.clock.advance(3 * DAY);
    const scheduler = world.makeScheduler();
    await scheduler.start();
    await waitForFired(id, 1);
    expect(await world.timers()).toEqual([]);
    await scheduler.close();
  });

  it("fires a repeat down for 3 days once, then keeps its schedule", async () => {
    const id = await idleThread();
    await world.add(id, { id: "r1", every: "1d", nextAt: START + DAY });
    world.clock.advance(3 * DAY + 2 * 60 * MINUTE);
    const scheduler = world.makeScheduler();
    await scheduler.start();
    await waitForFired(id, 1);
    const [timer] = await world.timers();
    expect(timer).toMatchObject({ firedCount: 1, nextAt: START + 4 * DAY });
    await scheduler.close();
  });

  it("expires a repeat after 7 days with a notice", async () => {
    const id = await idleThread();
    await world.add(id, { id: "r1", every: "1d", nextAt: START + DAY });
    world.clock.advance(7 * DAY);
    const scheduler = world.makeScheduler();
    await scheduler.tick();
    await vi.waitFor(async () => expect(await world.entriesOfKind(id, NOTICE_KIND)).toHaveLength(1), {
      timeout: 10_000,
    });
    expect(await world.timers()).toEqual([]);
    expect(await firedCount(id)).toBe(0);
    await scheduler.close();
  });

  it("does not fire after the thread is archived or deleted", async () => {
    const archived = await idleThread("r1");
    const deleted = await idleThread("r2");
    await world.add(archived, { id: "a1", nextAt: START + MINUTE });
    await world.add(deleted, { id: "d1", nextAt: START + MINUTE });
    await world.store.archive(archived, true, START);
    await world.store.remove(deleted, START);
    world.clock.advance(2 * MINUTE);
    const scheduler = world.makeScheduler();
    await scheduler.tick();
    expect(await world.timers()).toEqual([]);
    expect(await firedCount(archived)).toBe(0);
    expect(await firedCount(deleted)).toBe(0);
    await scheduler.close();
  });

  it("removes a timer whose thread disappears between the check and the submit", async () => {
    const id = await idleThread();
    await world.add(id, { id: "r1", nextAt: START + MINUTE });
    const gone: NotificationSubmitter = {
      notify: async (conversationId) => {
        throw new ThreadGoneError(conversationId);
      },
    };
    world.clock.advance(MINUTE);
    const scheduler = world.makeScheduler(gone);
    await scheduler.tick();
    expect(await world.timers()).toEqual([]);
    await scheduler.close();
  });

  it("counts and keeps the summary fields of the thread in step", async () => {
    const id = await idleThread();
    await world.add(id, { id: "r1", nextAt: START + 7 * MINUTE });
    await world.add(id, { id: "r2", nextAt: START + 3 * MINUTE });
    const summary = async () => (await world.store.list(world.project.id)).find((item) => item.id === id);
    expect(await summary()).toMatchObject({
      timers: 2,
      nextTimerAt: new Date(START + 3 * MINUTE).toISOString(),
    });
    const scheduler = world.makeScheduler();
    world.clock.advance(3 * MINUTE);
    await scheduler.tick();
    await waitForFired(id, 1);
    expect(await summary()).toMatchObject({
      timers: 2,
      nextTimerAt: new Date(START + 7 * MINUTE).toISOString(),
    });
    await scheduler.close();
  });

  it("limits a thread to 20 timers", async () => {
    const id = await idleThread();
    for (let index = 0; index < 20; index++) await world.add(id, { id: `t${index}` });
    await expect(world.add(id, { id: "t20" })).rejects.toThrow(/at most 20 timers/);
  });

  it("add is idempotent by id", async () => {
    const id = await idleThread();
    await world.add(id, { id: "same" });
    await world.add(id, { id: "same" });
    expect(await world.timers()).toHaveLength(1);
  });

  it("close waits for a fire in flight", async () => {
    const id = await idleThread();
    await world.add(id, { id: "r1", nextAt: START + MINUTE });
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const submitting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const slow: NotificationSubmitter = {
      notify: async () => {
        entered();
        await blocked;
      },
    };
    world.clock.advance(MINUTE);
    const scheduler = world.makeScheduler(slow);
    const ticking = scheduler.tick();
    await submitting;
    let closed = false;
    const closing = scheduler.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closed).toBe(false);
    release();
    await closing;
    await ticking;
    expect(closed).toBe(true);
    expect(await world.timers()).toMatchObject([{ firedCount: 1 }]);
  });

  it("scheduleAt runs once at its time and cancel drops it (the goals check-in API)", async () => {
    const scheduler = world.makeScheduler();
    const ran: string[] = [];
    scheduler.scheduleAt("a", START + MINUTE, async () => void ran.push("a"));
    scheduler.scheduleAt("b", START + MINUTE, async () => void ran.push("b"));
    scheduler.cancel("b");
    world.clock.advance(MINUTE);
    await scheduler.close();
    expect(ran).toEqual(["a"]);
  });
});

describe("timer fire with a busy thread", () => {
  beforeEach(async () => {
    await world.close();
    world = await openTimersWorld(directory, { tokensPerSecond: 20 });
  });

  const queuedStatus = async (threadId: string, requestId: string) =>
    (
      await world.harness.commit(
        (tx) => tx.submissionByRequest(Number(threadId) as ConversationId, requestId),
        BACKGROUND,
      )
    )?.status;

  it("queues app.timer_fired while the thread is busy, and coalesces the next fire", async () => {
    const id = await world.startThread("hello", "r1");
    await world.add(id, { id: "r1", nextAt: START + MINUTE });
    const scheduler = world.makeScheduler();
    world.clock.advance(MINUTE);
    await scheduler.tick();
    expect(await queuedStatus(id, "timer:r1:0")).toBe("queued");
    world.clock.advance(5 * MINUTE);
    await scheduler.tick();
    const [timer] = await world.timers();
    expect(timer).toMatchObject({
      firedCount: 1,
      lastFireRequestId: "timer:r1:0",
      nextAt: START + 11 * MINUTE,
    });
    await waitUntilIdle(world);
    await waitForFired(id, 1);
    await scheduler.close();
  });

  it("a crash between the submit and the counter commit submits the same requestId again", async () => {
    const id = await world.startThread("hello", "r1");
    await world.add(id, { id: "r1", nextAt: START + MINUTE });
    const real = world.makeScheduler();
    const crashing: NotificationSubmitter = {
      notify: async (conversationId, notification) => {
        await harnessNotificationSubmitter(world.harness).notify(conversationId, notification);
        throw new Error("crash before the counter commit");
      },
    };
    const silenced = vi.spyOn(console, "error").mockImplementation(() => {});
    world.clock.advance(MINUTE);
    const first = world.makeScheduler(crashing);
    await first.tick();
    await first.close();
    silenced.mockRestore();
    expect(await world.timers()).toMatchObject([{ firedCount: 0, lastFireRequestId: null }]);
    await real.tick();
    expect(await world.timers()).toMatchObject([{ firedCount: 1, lastFireRequestId: "timer:r1:0" }]);
    await waitUntilIdle(world);
    await waitForFired(id, 1);
    await real.close();
  });
});
