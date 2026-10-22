import { describe, expect, it } from "vitest";
import { NATIVE_EVENT_ENTRY_KIND, type NativeEvent, nativeEventOf, nativeEventsOf } from "./native-events";
import type { ConversationView } from "./view";

const viewOf = (entries: unknown[]) => ({ entries, docs: {} }) as unknown as ConversationView;
const entryOf = (id: number, data: unknown, kind: string = NATIVE_EVENT_ENTRY_KIND) => ({ id, kind, data });

const samples: readonly NativeEvent[] = [
  { type: "session", key: "s:init", sessionId: "s" },
  {
    type: "user",
    key: "r1:user",
    requestId: "r1",
    receiptId: "1:0:1",
    text: "hi",
    delivery: "queue",
    attachmentCount: 0,
  },
  { type: "lifecycle", key: "thread:accepted:1", lifecycle: "accepted" },
  { type: "lifecycle", key: "op:completed:9", lifecycle: "completed", operationId: "op", reason: "ok" },
  { type: "queue", key: "r1:queued", requestId: "r1", disposition: "queued" },
  { type: "assistant-text", key: "a", messageId: "m", partIndex: 0, text: "t" },
  { type: "assistant-thinking", key: "b", messageId: "m", partIndex: 1, text: "t", visible: true },
  { type: "tool-call", key: "c", callId: "c1", name: "Read", input: { path: "a" } },
  { type: "tool-result", key: "d", callId: "c1", isError: false, text: "x", imageCount: 0 },
  {
    type: "usage",
    key: "u",
    messageId: "m",
    inputTokens: 1,
    outputTokens: 2,
    cacheRead: 3,
    cacheWrite: 4,
  },
  { type: "result", key: "r", subtype: "success", isError: false, sessionId: "s", durationMs: 5 },
  { type: "notice", key: "n", code: "c", text: "t" },
];

describe("nativeEventOf", () => {
  it.each(samples)("accepts a well-formed $type event", (event) => {
    expect(nativeEventOf(entryOf(1, event))).toEqual(event);
  });

  it("ignores entries of another kind", () => {
    expect(nativeEventOf(entryOf(1, samples[0], "pi.user"))).toBeUndefined();
    expect(nativeEventOf({ kind: "pi.user" })).toBeUndefined();
  });

  it.each([
    ["no data", undefined],
    ["null data", null],
    ["an array", []],
    ["a string", "session"],
    ["no type", { key: "k" }],
    ["an unknown type", { type: "mystery", key: "k" }],
    ["an inherited type name", { type: "toString", key: "k" }],
    ["no key", { type: "session", sessionId: "s" }],
    ["a missing field", { type: "session", key: "k" }],
    [
      "a wrongly typed field",
      { type: "assistant-text", key: "k", messageId: "m", partIndex: "0", text: "t" },
    ],
    [
      "a non-finite number",
      { type: "tool-result", key: "k", callId: "c", isError: false, text: "", imageCount: Number.NaN },
    ],
    ["an unknown lifecycle", { type: "lifecycle", key: "k", lifecycle: "dancing" }],
    ["a wrongly typed optional", { type: "lifecycle", key: "k", lifecycle: "running", reason: 3 }],
    [
      "an unknown delivery",
      {
        type: "user",
        key: "k",
        requestId: "r",
        receiptId: "x",
        text: "",
        delivery: "now",
        attachmentCount: 0,
      },
    ],
    ["an unknown disposition", { type: "queue", key: "k", requestId: "r", disposition: "lost" }],
    ["a tool call without input", { type: "tool-call", key: "k", callId: "c", name: "n" }],
  ])("rejects %s without throwing", (_name, data) => {
    expect(nativeEventOf(entryOf(1, data))).toBeUndefined();
  });
});

describe("nativeEventsOf", () => {
  it("returns the events in entry order and skips everything else", () => {
    const view = viewOf([
      entryOf(1, samples[1]),
      { id: 2, kind: "pi.user", model: [{ role: "user", content: "x" }] },
      entryOf(3, { type: "session" }),
      entryOf(4, samples[5]),
      { id: 5, kind: NATIVE_EVENT_ENTRY_KIND },
    ]);
    expect(nativeEventsOf(view)).toEqual([samples[1], samples[5]]);
  });

  it("keeps the first event of a repeated key", () => {
    const first = { type: "assistant-text", key: "dup", messageId: "m", partIndex: 0, text: "first" };
    const again = { ...first, text: "second" };
    expect(nativeEventsOf(viewOf([entryOf(1, first), entryOf(2, again)]))).toEqual([first]);
  });

  it("is empty for a view without entries or without native entries", () => {
    expect(nativeEventsOf(viewOf([]))).toEqual([]);
    expect(nativeEventsOf({ docs: {} } as unknown as ConversationView)).toEqual([]);
  });
});
