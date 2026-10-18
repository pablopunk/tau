import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  CHUNK_BYTES,
  chunkBody,
  DATA_HEADER_BYTES,
  decodeDataFrame,
  encodeDataFrame,
  FLAG_END,
  LINK_MAX_PAYLOAD_BYTES,
  LinkFrameSchema,
} from "./machine-link";
import { LIVE_MAX_FRAME_BYTES, TERMINAL_STREAM_MAX_INPUT_BYTES } from "./terminal-stream";

describe("machine link constants", () => {
  it("lets a full chunk plus its header pass the link cap, and caps stay below it", () => {
    expect(LINK_MAX_PAYLOAD_BYTES).toBeGreaterThan(CHUNK_BYTES + DATA_HEADER_BYTES);
    expect(CHUNK_BYTES).toBe(256 * 1024);
    expect(LINK_MAX_PAYLOAD_BYTES).toBe(1024 * 1024);
    expect(TERMINAL_STREAM_MAX_INPUT_BYTES).toBeLessThan(CHUNK_BYTES);
    expect(LIVE_MAX_FRAME_BYTES).toBeLessThan(CHUNK_BYTES);
  });
});

describe("data frames", () => {
  it("round-trips an id, the flags and the payload", () => {
    const frame = { id: 0xfffffffe, end: true, text: true, payload: new Uint8Array([1, 2, 3]) };
    const bytes = encodeDataFrame(frame);
    expect(bytes.byteLength).toBe(DATA_HEADER_BYTES + 3);
    expect(bytes[4]).toBe(FLAG_END | 2);
    expect(decodeDataFrame(bytes)).toEqual(frame);
  });

  it("refuses a payload above a chunk and short frames", () => {
    expect(() =>
      encodeDataFrame({ id: 1, end: false, text: false, payload: new Uint8Array(CHUNK_BYTES + 1) }),
    ).toThrow();
    expect(decodeDataFrame(new Uint8Array(4))).toBeUndefined();
  });

  it("splits a 42 MB body into chunks that all fit the link cap, ending once", () => {
    const body = new Uint8Array(42 * 1024 * 1024 + 7);
    const frames = [...chunkBody(9, body)];
    expect(frames).toHaveLength(Math.ceil(body.byteLength / CHUNK_BYTES));
    expect(frames.filter((frame) => frame.end)).toHaveLength(1);
    expect(frames.at(-1)?.end).toBe(true);
    expect(Math.max(...frames.map((frame) => encodeDataFrame(frame).byteLength))).toBeLessThan(
      LINK_MAX_PAYLOAD_BYTES,
    );
    expect([...chunkBody(9, new Uint8Array())]).toEqual([
      { id: 9, end: true, text: false, payload: new Uint8Array() },
    ]);
  });
});

describe("text frames", () => {
  it("accepts every control frame and rejects unknown ones", () => {
    const valid = [
      { type: "hello", name: "m", os: "darwin", tauVersion: "1", protocolVersion: "p", threadCount: 2 },
      { type: "request", id: 1, method: "GET", path: "/api/conversations", query: "", hubDevice: "Safari" },
      { type: "response", id: 1, status: 200, headers: { "content-type": "application/json" } },
      { type: "open", id: 2, path: "/api/live", query: "", hubDevice: "Safari" },
      { type: "close", id: 2, code: 1000, reason: "" },
      { type: "credit", id: 2, bytes: 1024 },
      { type: "ping" },
      { type: "pong" },
    ];
    for (const frame of valid) expect(Value.Check(LinkFrameSchema, frame), JSON.stringify(frame)).toBe(true);
    for (const frame of [
      { type: "nope" },
      { type: "credit", id: 0, bytes: 1 },
      { type: "credit", id: 1, bytes: 0 },
    ]) {
      expect(Value.Check(LinkFrameSchema, frame), JSON.stringify(frame)).toBe(false);
    }
  });
});
