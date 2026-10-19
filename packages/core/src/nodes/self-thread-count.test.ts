import { describe, expect, it, vi } from "vitest";
import { createChangeEmitter } from "../change-emitter";
import { createSelfThreadCount } from "./self-thread-count";

describe("self thread count", () => {
  it("counts at start and again after a conversation change, never blocking a read", async () => {
    const changes = createChangeEmitter();
    let threads = 2;
    const counter = createSelfThreadCount(async () => threads, changes);
    expect(counter.current()).toBe(0);
    await vi.waitFor(() => expect(counter.current()).toBe(2));
    threads = 5;
    changes.emit({ resource: "conversations", projectId: "p" });
    await vi.waitFor(() => expect(counter.current()).toBe(5));
    counter.stop();
  });

  it("keeps the last good value when counting fails", async () => {
    const changes = createChangeEmitter();
    let fail = false;
    const counter = createSelfThreadCount(async () => {
      if (fail) throw new Error("closed");
      return 3;
    }, changes);
    await vi.waitFor(() => expect(counter.current()).toBe(3));
    fail = true;
    changes.emit({ resource: "conversations", projectId: "p" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(counter.current()).toBe(3);
  });
});
