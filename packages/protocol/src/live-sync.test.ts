import { describe, expect, it } from "vitest";
import { decodeClientFrame, decodeServerFrame, encodeFrame, livePingFrame, watchFailedFrame } from "./live";

describe("live sync frames", () => {
  it("round-trips a ping frame", () => {
    const raw = encodeFrame(livePingFrame(123));
    expect(decodeServerFrame(raw)).toEqual({ type: "ping", at: 123 });
  });

  it("round-trips a watch-failed frame with and without a reason", () => {
    expect(decodeServerFrame(encodeFrame(watchFailedFrame("c1")))).toEqual({
      type: "watch-failed",
      conversationId: "c1",
    });
    expect(decodeServerFrame(encodeFrame(watchFailedFrame("c1", "listener_error")))).toEqual({
      type: "watch-failed",
      conversationId: "c1",
      error: "listener_error",
    });
  });

  it("round-trips an ops frame carrying its per-conversation sequence number", () => {
    const raw = encodeFrame({ type: "ops", conversationId: "c1", ops: [], seq: 7 });
    expect(decodeServerFrame(raw)).toEqual({ type: "ops", conversationId: "c1", ops: [], seq: 7 });
  });

  it("still decodes ops frames from nodes that do not sequence them yet", () => {
    const raw = JSON.stringify({ type: "ops", conversationId: "c1", ops: [] });
    expect(decodeServerFrame(raw)).toEqual({ type: "ops", conversationId: "c1", ops: [] });
  });

  it("rejects unknown server frames", () => {
    expect(decodeServerFrame(JSON.stringify({ type: "bogus" }))).toBeUndefined();
  });

  it("round-trips a client pong", () => {
    expect(decodeClientFrame(encodeFrame({ type: "pong" }))).toEqual({ type: "pong" });
  });

  it("rejects client frames without a known type", () => {
    expect(decodeClientFrame(JSON.stringify({ type: "ping" }))).toBeUndefined();
  });
});
