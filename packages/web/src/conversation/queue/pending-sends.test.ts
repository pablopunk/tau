import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  attachReceipt,
  clearPending,
  failOptimistic,
  noteFailed,
  noteOptimistic,
  noteSending,
  resolvePending,
  usePendingSends,
} from "./pending-sends";

const message = { text: "hello", images: [], files: [] };

beforeEach(() => {
  clearPending();
});

describe("pending sends", () => {
  it("registers a sending bubble keyed by the returned submissionId", () => {
    const entry = noteSending("c1", { submissionId: 42 }, message);
    expect(entry.key).toBe("send-42");
    const { result } = renderHook(() => usePendingSends("c1"));
    expect(result.current.map((item) => item.submissionId)).toEqual([42]);
  });

  it("keeps the request id a receipt carries, and none when it carries none", () => {
    expect(noteSending("c1", { submissionId: 1, requestId: "req-1" }, message).requestId).toBe("req-1");
    expect(Object.keys(noteSending("c1", { submissionId: 2 }, message))).not.toContain("requestId");
  });

  it("scopes pending bubbles per conversation", () => {
    noteSending("c1", { submissionId: 1 }, message);
    noteSending("c2", { submissionId: 2 }, message);
    expect(renderHook(() => usePendingSends("c1")).result.current).toHaveLength(1);
    expect(renderHook(() => usePendingSends(undefined)).result.current).toHaveLength(0);
  });

  it("replaces a sending bubble when the receipt re-resolves the same id", () => {
    noteSending("c1", { submissionId: 5, entryId: 9 }, message);
    noteSending("c1", { submissionId: 5, entryId: 9 }, message);
    expect(renderHook(() => usePendingSends("c1")).result.current).toHaveLength(1);
  });

  it("registers failed sends with retry content and no submission id", () => {
    const entry = noteFailed("c1", message, "offline");
    expect(entry.status).toBe("failed");
    expect(entry.submissionId).toBeUndefined();
    const { result } = renderHook(() => usePendingSends("c1"));
    expect(result.current[0]?.error).toBe("offline");
  });

  it("resolves one bubble without touching the others", () => {
    const first = noteSending("c1", { submissionId: 1 }, message);
    noteSending("c1", { submissionId: 2 }, message);
    resolvePending("c1", first.key);
    const { result } = renderHook(() => usePendingSends("c1"));
    expect(result.current.map((item) => item.submissionId)).toEqual([2]);
  });

  it("shows an optimistic bubble at tap, before any receipt exists", () => {
    const entry = noteOptimistic("c1", "r1", message);
    expect(entry.status).toBe("sending");
    expect(entry.requestId).toBe("r1");
    expect(entry.submissionId).toBeUndefined();
    expect(renderHook(() => usePendingSends("c1")).result.current).toHaveLength(1);
  });

  it("attaches the receipt in place, keeping the key and position", () => {
    const first = noteOptimistic("c1", "r1", message);
    noteOptimistic("c1", "r2", message);
    attachReceipt("c1", "r1", { submissionId: 7, entryId: 3 });
    const { result } = renderHook(() => usePendingSends("c1"));
    expect(result.current.map((item) => item.key)).toEqual([first.key, "req-r2"]);
    expect(result.current[0]).toMatchObject({ submissionId: 7, entryId: 3, status: "sending" });
  });

  it("turns an optimistic bubble into a failed one in place", () => {
    noteOptimistic("c1", "r1", message);
    failOptimistic("c1", "r1", "offline");
    const { result } = renderHook(() => usePendingSends("c1"));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ status: "failed", error: "offline", text: "hello" });
  });

  it("ignores a receipt or failure for a bubble live state already placed", () => {
    noteOptimistic("c1", "r1", message);
    resolvePending("c1", "req-r1");
    attachReceipt("c1", "r1", { submissionId: 7 });
    failOptimistic("c1", "r1", "late");
    expect(renderHook(() => usePendingSends("c1")).result.current).toHaveLength(0);
  });
});
