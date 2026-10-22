import { describe, expect, it } from "vitest";
import { followNativeLines, type LiveClient } from "./live";
import { createNativeLineCursor, nativeAnswerOf, nativeViewToText } from "./native-text";
import { executeApiCommand } from "./run-command";
import {
  assistantTextEvent,
  FakeTau,
  lifecycleEvent,
  makeHome,
  nativeSummary,
  nativeViewWith,
  noticeEvent,
  summary,
  userEvent,
  viewWith,
} from "./test-support";

const events = [
  userEvent("u1", "fix it"),
  lifecycleEvent("l1", "running"),
  assistantTextEvent("a1", "On it.", "m1"),
  { type: "tool-call", key: "t1", callId: "c1", name: "bash", input: { command: "pnpm test" } },
  {
    type: "tool-result",
    key: "t2",
    callId: "c1",
    isError: false,
    text: `${"x".repeat(200)}\nmore`,
    imageCount: 0,
  },
  noticeEvent("n1", "Permission needed for Bash"),
  lifecycleEvent("l2", "blocked", "waiting for approval"),
  {
    type: "result",
    key: "r1",
    subtype: "error_during_execution",
    isError: true,
    text: "boom",
    sessionId: "s",
  },
  lifecycleEvent("l3", "outcome-unknown"),
];

describe("nativeViewToText", () => {
  it("renders user, assistant, tool calls, truncated results, notices, errors and notable lifecycle", () => {
    expect(nativeViewToText(nativeViewWith(events))).toBe(
      [
        "user: fix it",
        `assistant: On it.\n  > bash {"command":"pnpm test"}`,
        `  < ${"x".repeat(79)}…`,
        "notice: Permission needed for Bash",
        "[blocked] waiting for approval",
        "error: boom",
        "[outcome unknown]",
      ].join("\n\n"),
    );
  });

  it("keeps the last N messages", () => {
    expect(nativeViewToText(nativeViewWith(events), { last: 1 })).toBe("[outcome unknown]");
  });

  it("joins the text parts of one assistant message", () => {
    const view = nativeViewWith([
      assistantTextEvent("a1", "one", "m1"),
      { ...assistantTextEvent("a2", "two", "m1"), partIndex: 1 },
    ]);
    expect(nativeViewToText(view)).toBe("assistant: one\ntwo");
    expect(nativeAnswerOf(view)).toBe("one\ntwo");
  });

  it("falls back to the success result text when the operation has no assistant text", () => {
    const view = nativeViewWith([
      userEvent("u1", "x"),
      { type: "result", key: "r1", subtype: "success", isError: false, text: "final", sessionId: "s" },
    ]);
    expect(nativeAnswerOf(view)).toBe("final");
  });
});

describe("tau threads read", () => {
  it("renders a native thread through the native path", async () => {
    const fake = new FakeTau();
    fake.summaries = [nativeSummary("t1")];
    fake.views.set("t1", nativeViewWith(events.slice(0, 3)));
    await executeApiCommand("threads", ["read", "t1"], fake.env(makeHome()));
    expect(fake.stdout).toEqual(["user: fix it\n\nassistant: On it."]);
  });

  it("leaves Pi output unchanged", async () => {
    const fake = new FakeTau();
    fake.summaries = [summary("t1")];
    fake.views.set("t1", viewWith("the answer"));
    await executeApiCommand("threads", ["read", "t1"], fake.env(makeHome()));
    expect(fake.stdout).toEqual(["user: go\n\nassistant: the answer"]);
  });

  it("refuses native entries on a summary without an executor", async () => {
    const fake = new FakeTau();
    fake.summaries = [summary("t1")];
    fake.views.set("t1", nativeViewWith(events));
    const error = await executeApiCommand("threads", ["read", "t1"], fake.env(makeHome())).catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).message).toMatch(/names no executor/);
  });
});

function fakeLive(): { client: LiveClient; push(view: ReturnType<typeof nativeViewWith> | null): void } {
  let current: ReturnType<typeof nativeViewWith> | null | undefined;
  const listeners: (() => void)[] = [];
  const client: LiveClient = {
    subscribe: () => undefined,
    view: () => current,
    onFrame: (listener) => listeners.push(listener),
    onClose: () => undefined,
    close: () => undefined,
  };
  return {
    client,
    push(view) {
      current = view;
      for (const listener of listeners) listener();
    },
  };
}

describe("followNativeLines", () => {
  it("emits lines incrementally, each lifecycle and notice once", () => {
    const { client, push } = fakeLive();
    const lines: string[] = [];
    followNativeLines(client, "t1", (line) => lines.push(line));
    push(nativeViewWith(events.slice(0, 3)));
    push(nativeViewWith(events.slice(0, 7)));
    expect(lines).toEqual([
      "user: fix it",
      "[running]",
      "assistant: On it.",
      `  > bash {"command":"pnpm test"}`,
      `  < ${"x".repeat(79)}…`,
      "notice: Permission needed for Bash",
      "[blocked] waiting for approval",
    ]);
  });

  it("does not duplicate lines when a reconnected client replays the whole view", () => {
    const cursor = createNativeLineCursor();
    const lines: string[] = [];
    const first = fakeLive();
    followNativeLines(first.client, "t1", (line) => lines.push(line), cursor);
    first.push(nativeViewWith(events.slice(0, 3)));
    const second = fakeLive();
    followNativeLines(second.client, "t1", (line) => lines.push(line), cursor);
    second.push(nativeViewWith(events));
    second.push(nativeViewWith(events));
    expect(lines.filter((line) => line === "user: fix it")).toHaveLength(1);
    expect(lines.filter((line) => line === "[outcome unknown]")).toHaveLength(1);
    expect(lines).toHaveLength(9);
  });
});
