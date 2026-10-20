import { describe, expect, it } from "vitest";
import { createSlotQueue, type SlotInfo } from "./slot-queue";

const info = (entryId: string): SlotInfo => ({ entryId, conversationId: "c", command: entryId, since: 0 });

describe("slot queue", () => {
  it("grants in FIFO order and hands slots on release", async () => {
    const queue = createSlotQueue(1);
    const a = queue.acquire(info("a"));
    const b = queue.acquire(info("b"));
    expect(await a.promise).toBe(true);
    expect(queue.snapshot().waiting.map((slot) => slot.entryId)).toEqual(["b"]);
    a.release();
    expect(await b.promise).toBe(true);
    expect(queue.snapshot().holders.map((slot) => slot.entryId)).toEqual(["b"]);
  });

  it("cancels a pending waiter", async () => {
    const queue = createSlotQueue(1);
    queue.acquire(info("a"));
    const b = queue.acquire(info("b"));
    b.cancel();
    expect(await b.promise).toBe(false);
    expect(queue.snapshot().waiting).toEqual([]);
  });

  it("releases a granted but unconsumed slot on cancel, and release is idempotent", async () => {
    const queue = createSlotQueue(1);
    const a = queue.acquire(info("a"));
    const b = queue.acquire(info("b"));
    a.cancel();
    a.release();
    a.cancel();
    expect(await b.promise).toBe(true);
    expect(queue.snapshot().holders).toHaveLength(1);
  });

  it("follows a live limit: raising and null wake waiters, lowering never kills", async () => {
    const queue = createSlotQueue(1);
    queue.acquire(info("a"));
    const b = queue.acquire(info("b"));
    const c = queue.acquire(info("c"));
    queue.setLimit(2);
    expect(await b.promise).toBe(true);
    queue.setLimit(null);
    expect(await c.promise).toBe(true);
    queue.setLimit(1);
    expect(queue.snapshot().holders).toHaveLength(3);
    expect(queue.acquire(info("d")).promise).not.toBe(undefined);
    expect(queue.snapshot().waiting.map((slot) => slot.entryId)).toEqual(["d"]);
  });

  it("emits a change on queue, grant and release", () => {
    let changes = 0;
    const queue = createSlotQueue(1, () => changes++);
    const a = queue.acquire(info("a"));
    a.release();
    expect(changes).toBe(2);
  });
});
