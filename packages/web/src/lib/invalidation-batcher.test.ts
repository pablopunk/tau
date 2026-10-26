import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvalidationBatcher } from "./invalidation-batcher";
import type { InvalidationStep } from "./invalidation-scope";

const firstStep: InvalidationStep = { queryKey: ["goal", "c1"] };

describe("createInvalidationBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("applies the first step immediately", () => {
    const apply = vi.fn();
    const batcher = createInvalidationBatcher(apply);

    batcher.enqueue(firstStep);

    expect(apply).toHaveBeenCalledExactlyOnceWith(firstStep);
  });

  it("runs one trailing step for a burst and keeps the last change", () => {
    const apply = vi.fn();
    const duplicateStep: InvalidationStep = { queryKey: ["goal", "c1"] };
    const lastStep: InvalidationStep = { queryKey: ["goal", "c1"] };
    const batcher = createInvalidationBatcher(apply);

    batcher.enqueue(firstStep);
    batcher.enqueue(duplicateStep);
    batcher.enqueue(lastStep);

    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(249);
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);

    expect(apply.mock.calls).toEqual([[firstStep], [lastStep]]);
  });

  it("batches distinct steps independently", () => {
    const apply = vi.fn();
    const otherStep: InvalidationStep = { queryKey: ["workspace", "c1"] };
    const activeStep: InvalidationStep = { queryKey: ["goal", "c1"], refetchType: "active" };
    const batcher = createInvalidationBatcher(apply);

    batcher.enqueue(firstStep);
    batcher.enqueue(otherStep);
    batcher.enqueue(activeStep);
    batcher.enqueue(firstStep);

    expect(apply.mock.calls).toEqual([[firstStep], [otherStep], [activeStep]]);
    vi.advanceTimersByTime(250);

    expect(apply.mock.calls).toEqual([[firstStep], [otherStep], [activeStep], [firstStep]]);
  });

  it("cancels trailing work when disposed", () => {
    const apply = vi.fn();
    const batcher = createInvalidationBatcher(apply);

    batcher.enqueue(firstStep);
    batcher.enqueue(firstStep);
    batcher.dispose();
    vi.advanceTimersByTime(250);

    expect(apply).toHaveBeenCalledExactlyOnceWith(firstStep);
    batcher.enqueue(firstStep);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
