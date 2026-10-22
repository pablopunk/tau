import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { NativeEvent } from "./events";
import { createNormalizerState, normalizeSdkMessage } from "./normalize";

type Scenario = "read" | "deniedTool" | "errorMaxTurns";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../testing/fixtures/sdk-messages.json");
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { scenarios: Record<Scenario, unknown[]> };

const replay = (messages: readonly unknown[], state = createNormalizerState()): NativeEvent[] =>
  messages.flatMap((message) => normalizeSdkMessage(message, state));

const READ_SESSION = "23119d61-5d98-4e5c-b953-6aec9c6ed4ef";
const DENIED_SESSION = "08f43c28-14e2-4e36-b5d1-e49bf50bcf07";
const ERROR_SESSION = "70020069-1d06-4195-8a87-b991476a2edd";
const READ_FILE = "<TMP>/cwd/fixture.txt";
const FIXTURE_TEXT = "tau-offline-fixture-text-7f3a";

describe("normalizeSdkMessage on the recorded Read turn", () => {
  const events = replay(fixture.scenarios.read);

  it("produces the exact event sequence with stable keys", () => {
    expect(events).toEqual([
      { type: "session", key: `${READ_SESSION}:init`, sessionId: READ_SESSION },
      {
        type: "tool-call",
        key: `${READ_SESSION}:a9729878-2296-43e0-9438-85e556429429:0`,
        callId: "toolu_fake_read_0001",
        name: "Read",
        input: { file_path: READ_FILE },
      },
      {
        type: "usage",
        key: `${READ_SESSION}:msg_fake_1:usage`,
        messageId: "msg_fake_1",
        inputTokens: 10,
        outputTokens: 1,
        cacheRead: 0,
        cacheWrite: 0,
      },
      {
        type: "tool-result",
        key: `${READ_SESSION}:ade6d710-740d-4888-9267-acf50970974e:0`,
        callId: "toolu_fake_read_0001",
        isError: false,
        text: `1\t${FIXTURE_TEXT}\n2\t`,
        imageCount: 0,
      },
      {
        type: "assistant-text",
        key: `${READ_SESSION}:bd3c0d0e-95a3-410b-8653-b8c55d6e7185:0`,
        messageId: "msg_fake_2",
        partIndex: 0,
        text: `The file says: ${FIXTURE_TEXT}. (scripted)`,
      },
      {
        type: "usage",
        key: `${READ_SESSION}:msg_fake_2:usage`,
        messageId: "msg_fake_2",
        inputTokens: 10,
        outputTokens: 1,
        cacheRead: 0,
        cacheWrite: 0,
      },
      {
        type: "result",
        key: `${READ_SESSION}:dbc7cf08-78f4-4c9f-a65f-414cebd1694e:result`,
        subtype: "success",
        isError: false,
        text: `The file says: ${FIXTURE_TEXT}. (scripted)`,
        durationMs: 58,
        costUsd: 0.00021,
        sessionId: READ_SESSION,
      },
    ]);
  });

  it("has unique keys", () => {
    expect(new Set(events.map((event) => event.key)).size).toBe(events.length);
  });

  it("ignores partial stream events and status chatter", () => {
    const noise = fixture.scenarios.read.filter((message) => {
      const { type, subtype } = message as { type: string; subtype?: string };
      return type === "stream_event" || subtype === "status" || subtype === "session_title_changed";
    });
    expect(noise.length).toBeGreaterThan(0);
    expect(replay(noise)).toEqual([]);
  });
});

describe("normalizeSdkMessage on the recorded failure turns", () => {
  it("surfaces a denied tool as an error tool-result plus a permission notice", () => {
    const events = replay(fixture.scenarios.deniedTool);
    const toolResult = events.find((event) => event.type === "tool-result");
    expect(toolResult).toMatchObject({ callId: "toolu_fake_bash_0001", isError: true });
    expect(events.find((event) => event.type === "notice")).toMatchObject({
      code: "permission-denied",
      key: `${DENIED_SESSION}:3ecd3c1a-6dbf-4b8b-9739-8aecc3866f57:permission-denied`,
    });
    expect(events.at(-1)).toMatchObject({ type: "result", subtype: "success", isError: false });
  });

  it("maps an error result to isError with the SDK error text", () => {
    const result = replay(fixture.scenarios.errorMaxTurns).at(-1);
    expect(result).toEqual({
      type: "result",
      key: `${ERROR_SESSION}:edb634a0-3b61-4810-9c38-18da9e891395:result`,
      subtype: "error_max_turns",
      isError: true,
      text: "Reached maximum number of turns (1)",
      durationMs: 43,
      costUsd: 0.000105,
      sessionId: ERROR_SESSION,
    });
  });
});

describe("normalizeSdkMessage dedupe", () => {
  it("emits nothing when the same messages are replayed with the same state", () => {
    const state = createNormalizerState();
    const first = replay(fixture.scenarios.read, state);
    expect(first.length).toBeGreaterThan(0);
    expect(replay(fixture.scenarios.read, state)).toEqual([]);
  });

  it("yields identical keys on a replay with fresh state so the store can dedupe", () => {
    const keys = (events: NativeEvent[]) => events.map((event) => event.key);
    expect(keys(replay(fixture.scenarios.read))).toEqual(keys(replay(fixture.scenarios.read)));
  });

  it("dedupes by uuid and part index, never by text", () => {
    const state = createNormalizerState();
    const assistant = (uuid: string) => ({
      type: "assistant",
      uuid,
      session_id: "s1",
      message: { id: "msg_1", content: [{ type: "text", text: "same text" }] },
    });
    const events = [assistant("u1"), assistant("u2"), assistant("u1")].flatMap((message) =>
      normalizeSdkMessage(message, state),
    );
    expect(events.map((event) => event.key)).toEqual(["s1:u1:0", "s1:u2:0"]);
  });

  it("dedupes usage across assistant messages that share one API message id", () => {
    const state = createNormalizerState();
    const split = (uuid: string, text: string) => ({
      type: "assistant",
      uuid,
      session_id: "s1",
      message: {
        id: "msg_1",
        content: [{ type: "text", text }],
        usage: { input_tokens: 3, output_tokens: 4 },
      },
    });
    const events = [split("u1", "a"), split("u2", "b")].flatMap((message) =>
      normalizeSdkMessage(message, state),
    );
    expect(events.filter((event) => event.type === "usage")).toHaveLength(1);
  });
});

describe("normalizeSdkMessage tolerance", () => {
  const state = () => ({ sessionId: "s1", seen: new Set<string>() });

  it("turns an unknown message into a notice without throwing", () => {
    const events = normalizeSdkMessage({ type: "brand_new", uuid: "u9", session_id: "s1" }, state());
    expect(events).toEqual([
      {
        type: "notice",
        key: "s1:u9:unknown",
        code: "unknown-message",
        text: "Unrecognised SDK message: brand_new.",
      },
    ]);
  });

  it("turns an unknown system subtype into a notice", () => {
    const [event] = normalizeSdkMessage(
      { type: "system", subtype: "novel", uuid: "u9", session_id: "s1" },
      state(),
    );
    expect(event).toMatchObject({
      type: "notice",
      code: "unknown-message",
      text: expect.stringContaining("system/novel"),
    });
  });

  it.each([null, undefined, 42, "text", [], { nothing: true }])("never throws on %j", (input) => {
    const events = normalizeSdkMessage(input, state());
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("notice");
  });

  it("does not throw on malformed content blocks and notices each one", () => {
    const assistant = {
      type: "assistant",
      uuid: "u1",
      session_id: "s1",
      message: {
        id: "m1",
        content: [
          null,
          7,
          { type: "text" },
          { type: "tool_use", id: "c1" },
          { type: "server_tool_use" },
          { type: "text", text: "ok" },
        ],
      },
    };
    const events = normalizeSdkMessage(assistant, state());
    expect(events.map((event) => (event.type === "notice" ? event.code : event.type))).toEqual([
      "malformed-block",
      "malformed-block",
      "malformed-block",
      "malformed-block",
      "unsupported-block",
      "assistant-text",
    ]);
  });

  it("does not throw on assistant or user messages without content", () => {
    expect(
      normalizeSdkMessage({ type: "assistant", uuid: "u1", session_id: "s1" }, state())[0],
    ).toMatchObject({
      code: "malformed-message",
    });
    expect(normalizeSdkMessage({ type: "user", uuid: "u2", session_id: "s1", message: {} }, state())).toEqual(
      [],
    );
    expect(
      normalizeSdkMessage(
        { type: "user", uuid: "u3", session_id: "s1", message: { content: [1, { type: "tool_result" }] } },
        state(),
      ),
    ).toHaveLength(2);
  });

  it("does not throw on a circular message", () => {
    const circular: Record<string, unknown> = { type: "mystery" };
    circular.self = circular;
    expect(normalizeSdkMessage(circular, state())[0]).toMatchObject({ type: "notice" });
  });

  it("reads tool_result content given as a string or as an array of blocks", () => {
    const userWith = (content: unknown) => ({
      type: "user",
      uuid: "u1",
      session_id: "s1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "c1", content, is_error: true }],
      },
    });
    const of = (content: unknown) => normalizeSdkMessage(userWith(content), state())[0];
    expect(of("plain")).toMatchObject({ type: "tool-result", text: "plain", imageCount: 0, isError: true });
    expect(
      of([
        { type: "text", text: "first" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "" } },
        { type: "text", text: "second" },
      ]),
    ).toMatchObject({ text: "first\nsecond", imageCount: 1 });
    expect(of(undefined)).toMatchObject({ text: "", imageCount: 0 });
  });

  it("maps thinking blocks with a visibility flag", () => {
    const message = {
      type: "assistant",
      uuid: "u1",
      session_id: "s1",
      message: {
        id: "m1",
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "redacted_thinking", data: "x" },
        ],
      },
    };
    expect(normalizeSdkMessage(message, state())).toMatchObject([
      { type: "assistant-thinking", text: "hmm", visible: true, partIndex: 0 },
      { type: "assistant-thinking", text: "", visible: false, partIndex: 1 },
    ]);
  });

  it("falls back to the tracked session id when a message lacks one", () => {
    const [event] = normalizeSdkMessage(
      { type: "result", subtype: "success", uuid: "u1", result: "x" },
      state(),
    );
    expect(event).toMatchObject({ sessionId: "s1", key: "s1:u1:result" });
  });
});
