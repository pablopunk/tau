import { describe, expect, it } from "vitest";
import type { ClaudeToolResult } from "../sdk-types";
import { createObservedResultStore } from "./observed-results";

const IMAGE_RESULT: ClaudeToolResult = {
  content: [
    { type: "text", text: "chart" },
    { type: "image", data: "AAAA", mimeType: "image/png" },
  ],
  isError: true,
};

const live = () => new AbortController().signal;

describe("observed result store", () => {
  it("returns a result that arrived before the wait, unchanged", async () => {
    const store = createObservedResultStore();
    store.settle("t1", IMAGE_RESULT);
    expect(await store.wait("t1", live())).toBe(IMAGE_RESULT);
  });

  it("resolves a waiter when the result arrives later", async () => {
    const store = createObservedResultStore();
    const waiting = store.wait("t1", live());
    store.settle("t1", IMAGE_RESULT);
    expect(await waiting).toBe(IMAGE_RESULT);
  });

  it("rejects aborted when the signal fires", async () => {
    const store = createObservedResultStore();
    const controller = new AbortController();
    const waiting = store.wait("t1", controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow("aborted");
  });

  it("rejects at once with an already aborted signal", async () => {
    const store = createObservedResultStore();
    const controller = new AbortController();
    controller.abort();
    await expect(store.wait("t1", controller.signal)).rejects.toThrow("aborted");
  });

  it("knows connector ids until they are forgotten", () => {
    const store = createObservedResultStore();
    store.settle("t1", IMAGE_RESULT);
    expect(store.isConnectorCall("t1")).toBe(true);
    store.forget("t1");
    expect(store.isConnectorCall("t1")).toBe(false);
  });
});
