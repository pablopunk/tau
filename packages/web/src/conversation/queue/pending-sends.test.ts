import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearPending, noteFailed, noteSending, resolvePending, usePendingSends } from "./pending-sends";

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
});
