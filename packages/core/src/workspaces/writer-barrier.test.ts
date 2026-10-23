import { describe, expect, test } from "vitest";
import { createWriterBarrier } from "./writer-barrier";

const gate = () => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
};

const codeOf = (action: () => void) => {
  try {
    action();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe("writer barrier", () => {
  test("never blocks anyone while the key is not fenced", () => {
    const barrier = createWriterBarrier();
    expect(barrier.isFenced("w")).toBe(false);
    expect(codeOf(() => barrier.assertOpen("w", "1"))).toBe("ok");
  });

  test("lets the owner through and rejects any other thread while fenced", async () => {
    const barrier = createWriterBarrier();
    const hold = gate();
    const running = barrier.run("w", "1", () => hold.opened);
    expect(barrier.isFenced("w")).toBe(true);
    expect(codeOf(() => barrier.assertOpen("w", "1"))).toBe("ok");
    expect(codeOf(() => barrier.assertOpen("w", "2"))).toBe("thread_busy");
    hold.open();
    await running;
    expect(barrier.isFenced("w")).toBe(false);
    expect(codeOf(() => barrier.assertOpen("w", "2"))).toBe("ok");
  });

  test("releases the fence when the task throws", async () => {
    const barrier = createWriterBarrier();
    await expect(
      barrier.run("w", "1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(barrier.isFenced("w")).toBe(false);
    expect(codeOf(() => barrier.assertOpen("w", "2"))).toBe("ok");
  });

  test("serializes concurrent runs on the same key", async () => {
    const barrier = createWriterBarrier();
    const events: string[] = [];
    const hold = gate();
    const first = barrier.run("w", "1", async () => {
      events.push("first start");
      await hold.opened;
      events.push("first end");
    });
    const second = barrier.run("w", "2", async () => {
      events.push("second start");
    });
    await Promise.resolve();
    expect(events).toEqual(["first start"]);
    hold.open();
    await Promise.all([first, second]);
    expect(events).toEqual(["first start", "first end", "second start"]);
  });

  test("keeps the fence up between two queued runs", async () => {
    const barrier = createWriterBarrier();
    const hold = gate();
    const first = barrier.run("w", "1", () => hold.opened);
    const second = barrier.run("w", "2", async () => undefined);
    hold.open();
    await first;
    expect(barrier.isFenced("w")).toBe(true);
    await second;
    expect(barrier.isFenced("w")).toBe(false);
  });

  test("does not let independent keys block each other", async () => {
    const barrier = createWriterBarrier();
    const hold = gate();
    const running = barrier.run("a", "1", () => hold.opened);
    let ran = false;
    await barrier.run("b", "2", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(codeOf(() => barrier.assertOpen("b", "3"))).toBe("ok");
    hold.open();
    await running;
  });
});
