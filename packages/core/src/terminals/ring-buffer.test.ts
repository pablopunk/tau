import { describe, expect, it } from "vitest";
import { createRingBuffer } from "./ring-buffer";

const bytes = (text: string) => new TextEncoder().encode(text);
const joined = (ring: ReturnType<typeof createRingBuffer>, frame = 1 << 20) =>
  ring
    .frames(frame)
    .map((f) => new TextDecoder().decode(f))
    .join("");

describe("ring buffer", () => {
  it("keeps everything under the limit, in order", () => {
    const ring = createRingBuffer(100);
    ring.push(bytes("one "));
    ring.push(bytes("two"));
    expect(joined(ring)).toBe("one two");
  });

  it("keeps the newest bytes and starts at a line or escaped after the first eviction", () => {
    const ring = createRingBuffer(20);
    ring.push(bytes("aaaaaaaaaa\nbbbbbbbbb"));
    ring.push(bytes("cccccc"));
    expect(ring.size).toBeLessThanOrEqual(20);
    expect(joined(ring)).toBe("\nbbbbbbbbbcccccc");
    const escaped = createRingBuffer(10);
    escaped.push(bytes("xxxxxx\x1b[1mabcde"));
    expect(joined(escaped)).toBe("\x1b[1mabcde");
  });

  it("skips UTF-8 continuation bytes at the start", () => {
    const ring = createRingBuffer(6);
    ring.push(bytes("é€€€"));
    const all = ring.frames(100)[0] as Uint8Array;
    expect(all.length).toBeLessThanOrEqual(6);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(all)).not.toThrow();
  });

  it("splits replay into frames of at most the frame size", () => {
    const ring = createRingBuffer(1000);
    for (let index = 0; index < 100; index++) ring.push(bytes("0123456789"));
    const frames = ring.frames(300);
    expect(frames.map((frame) => frame.length)).toEqual([300, 300, 300, 100]);
  });

  it("holds a flood of tiny chunks within the limit", () => {
    const ring = createRingBuffer(256 * 1024);
    for (let index = 0; index < 200_000; index++) ring.push(bytes("yy\r\n"));
    expect(ring.size).toBeLessThanOrEqual(256 * 1024);
  });
});
