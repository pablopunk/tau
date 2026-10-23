import { describe, expect, it } from "vitest";
import { assistantTextEvent, lifecycleEvent, nativeView, queueEvent, userEvent } from "../native-fixtures";
import { endOf } from "../test-utils";
import { NATIVE_ATTACHMENTS_REASON, threadExecutorOf } from "./executor";
import {
  nativeNoticeOf,
  nativeRequestIdsOf,
  OUTCOME_UNKNOWN_TEXT,
  queuedNativeUserKeysOf,
} from "./native-thread";

describe("threadExecutorOf", () => {
  it("takes the executor the summary names", () => {
    expect(threadExecutorOf({ executor: "claude-code" }, undefined)).toBe("claude-code");
  });

  it("recognises a native view before the summary arrives", () => {
    expect(threadExecutorOf(undefined, nativeView([userEvent("a", "r1", "hi")]))).toBe("claude-code");
  });

  it("leaves a Pi thread without an executor", () => {
    expect(threadExecutorOf({}, endOf("text"))).toBeUndefined();
    expect(threadExecutorOf(undefined, undefined)).toBeUndefined();
  });
});

describe("nativeNoticeOf", () => {
  it("asks the user to check the workspace after an unknown outcome", () => {
    const view = nativeView([userEvent("a", "r1", "go"), lifecycleEvent("b", "outcome-unknown")]);
    expect(nativeNoticeOf(view)?.text).toBe(OUTCOME_UNKNOWN_TEXT);
  });

  it("shows a blocked run with its reason", () => {
    const view = nativeView([lifecycleEvent("a", "blocked", "needs a decision")]);
    expect(nativeNoticeOf(view)).toEqual({ text: "The run is blocked.", reason: "needs a decision" });
  });

  it("shows nothing once a later lifecycle settled the thread", () => {
    const view = nativeView([lifecycleEvent("a", "outcome-unknown"), lifecycleEvent("b", "completed")]);
    expect(nativeNoticeOf(view)).toBeUndefined();
  });
});

describe("native request ids and queue", () => {
  const view = nativeView([
    userEvent("u1", "r1", "first"),
    userEvent("u2", "r2", "second"),
    queueEvent("q1", "r2", "queued"),
    assistantTextEvent("t1", "ok"),
  ]);

  it("lists the request id of every user event", () => {
    expect([...nativeRequestIdsOf(view)]).toEqual(["r1", "r2"]);
  });

  it("marks only the still-queued user events", () => {
    expect([...queuedNativeUserKeysOf(view)]).toEqual(["u2"]);
  });

  it("stops marking a message once it was delivered", () => {
    const delivered = nativeView([
      userEvent("u2", "r2", "second"),
      queueEvent("q1", "r2", "queued"),
      queueEvent("q2", "r2", "delivered"),
    ]);
    expect(queuedNativeUserKeysOf(delivered).size).toBe(0);
  });
});

describe("attachments reason", () => {
  it("is the core's limitation, as a sentence", () => {
    expect(NATIVE_ATTACHMENTS_REASON).toBe("Attachments are not supported for native threads yet.");
  });
});
