import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COALESCE_MAX_BYTES, createCoalescer, MAX_FRAME_BYTES } from "./coalescer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const bytes = (n: number) => new Uint8Array(n).fill(65);

describe("coalescer", () => {
  it("joins tiny chunks within the window into one frame", () => {
    const frames: Uint8Array[] = [];
    const coalescer = createCoalescer((frame) => frames.push(frame));
    for (let i = 0; i < 100; i++) coalescer.push(bytes(6));
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(8);
    expect(frames.map((frame) => frame.length)).toEqual([600]);
  });

  it("flushes at 16 KB without waiting", () => {
    const frames: Uint8Array[] = [];
    const coalescer = createCoalescer((frame) => frames.push(frame));
    coalescer.push(bytes(COALESCE_MAX_BYTES - 1));
    coalescer.push(bytes(1));
    expect(frames.map((frame) => frame.length)).toEqual([COALESCE_MAX_BYTES]);
  });

  it("never sends a frame above 64 KB", () => {
    const frames: Uint8Array[] = [];
    const coalescer = createCoalescer((frame) => frames.push(frame));
    coalescer.push(bytes(MAX_FRAME_BYTES * 2 + 10));
    coalescer.flush();
    expect(frames.every((frame) => frame.length <= MAX_FRAME_BYTES)).toBe(true);
    expect(frames.reduce((sum, frame) => sum + frame.length, 0)).toBe(MAX_FRAME_BYTES * 2 + 10);
  });
});
