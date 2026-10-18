import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALL_BYTES, STALL_MS, watchStall } from "./stall-watch";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("watchStall", () => {
  it("fires after the buffer stays above 1 MB for 5 s", () => {
    const socket = { bufferedAmount: STALL_BYTES + 1 };
    const onStalled = vi.fn();
    watchStall(socket, onStalled);
    vi.advanceTimersByTime(STALL_MS - 500);
    expect(onStalled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onStalled).toHaveBeenCalledTimes(1);
  });

  it("resets when the buffer drains", () => {
    const socket = { bufferedAmount: STALL_BYTES + 1 };
    const onStalled = vi.fn();
    watchStall(socket, onStalled);
    vi.advanceTimersByTime(4000);
    socket.bufferedAmount = 0;
    vi.advanceTimersByTime(1000);
    socket.bufferedAmount = STALL_BYTES + 1;
    vi.advanceTimersByTime(4000);
    expect(onStalled).not.toHaveBeenCalled();
  });
});
