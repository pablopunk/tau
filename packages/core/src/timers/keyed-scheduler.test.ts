import { describe, expect, it, vi } from "vitest";
import { createFakeClock } from "./fake-clock";
import { createKeyedScheduler } from "./keyed-scheduler";

describe("keyed scheduler", () => {
  it("runs a scheduled task once at its time", () => {
    const clock = createFakeClock(1000);
    const scheduler = createKeyedScheduler(clock);
    const run = vi.fn(async () => {});
    scheduler.scheduleAt("a", 1500, run);
    clock.advance(499);
    expect(run).not.toHaveBeenCalled();
    clock.advance(1);
    clock.advance(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("replaces a task with the same key and cancels by key", () => {
    const clock = createFakeClock();
    const scheduler = createKeyedScheduler(clock);
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    scheduler.scheduleAt("a", 100, first);
    scheduler.scheduleAt("a", 200, second);
    scheduler.scheduleAt("b", 100, first);
    scheduler.cancel("b");
    clock.advance(300);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("runs at once when the time has passed", () => {
    const clock = createFakeClock(5000);
    const scheduler = createKeyedScheduler(clock);
    const run = vi.fn(async () => {});
    scheduler.scheduleAt("late", 10, run);
    clock.advance(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("close cancels pending tasks and waits for a run in flight", async () => {
    const clock = createFakeClock();
    const scheduler = createKeyedScheduler(clock);
    let finish = () => {};
    const slow = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const pending = vi.fn(async () => {});
    scheduler.scheduleAt("slow", 10, slow);
    scheduler.scheduleAt("pending", 1000, pending);
    clock.advance(10);
    let closed = false;
    const closing = scheduler.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    finish();
    await closing;
    clock.advance(2000);
    expect(pending).not.toHaveBeenCalled();
  });
});
