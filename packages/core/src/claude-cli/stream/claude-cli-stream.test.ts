import { describe, expect, it } from "vitest";
import { scriptOf } from "../testing/fake-claude-script";
import {
  ask,
  createHarness,
  getNumber,
  getWord,
  systemMessage,
  textOfMessage,
  toolCallsOf,
  toolResultFor,
  userMessage,
} from "./test-support";

const twoToolsThenText = scriptOf([
  [
    { kind: "tools", calls: [{ name: "get_word" }, { name: "get_number" }] },
    { kind: "text", text: "banana 42", thinking: "hm" },
  ],
]);

describe("adapter streams", () => {
  it("maps one API message to one Pi stream with text deltas and zero cost", async () => {
    const harness = createHarness({ script: scriptOf([[{ kind: "text", text: "hello", thinking: "hm" }]]) });
    const { events, message } = await ask(harness, [systemMessage(), userMessage("hi")]);
    const types = events.map((event) => event.type);
    expect(types[0]).toBe("start");
    expect(types).toContain("thinking_delta");
    expect(types).toContain("text_delta");
    expect(types.at(-1)).toBe("done");
    expect(textOfMessage(message)).toBe("hello");
    expect(message.stopReason).toBe("stop");
    expect(message.responseModel).toBeDefined();
    expect(message.usage).toMatchObject({ input: 10, output: 5, totalTokens: 15 });
    expect(message.usage.cost.total).toBe(0);
  });

  it("ends a tool round with toolUse and every call, then continues in the same process", async () => {
    const harness = createHarness({ script: twoToolsThenText });
    const messages = [systemMessage(), userMessage("go")];
    const first = await ask(harness, messages);
    expect(first.message.stopReason).toBe("toolUse");
    const calls = toolCallsOf(first.message);
    expect(calls.map((call) => call.name)).toEqual(["get_word", "get_number"]);
    expect(first.events.filter((event) => event.type === "toolcall_end")).toHaveLength(2);
    const second = await ask(harness, [
      ...messages,
      first.message,
      toolResultFor(calls[0] as never, "banana"),
      toolResultFor(calls[1] as never, "42"),
    ]);
    expect(textOfMessage(second.message)).toBe("banana 42");
    expect(harness.fake.queries).toHaveLength(1);
    expect(harness.fake.queries[0]?.toolResults.map((result) => result.text)).toEqual(["banana", "42"]);
  });

  it("delivers a result for the second call before the first (reverse order)", async () => {
    const harness = createHarness({ script: twoToolsThenText });
    const messages = [systemMessage(), userMessage("go")];
    const first = await ask(harness, messages);
    const [one, two] = toolCallsOf(first.message);
    const second = await ask(harness, [
      ...messages,
      first.message,
      toolResultFor(two as never, "42"),
      toolResultFor(one as never, "banana"),
    ]);
    expect(second.message.stopReason).toBe("stop");
    expect(harness.fake.queries[0]?.toolResults.map((result) => result.toolUseId)).toEqual([
      one?.id,
      two?.id,
    ]);
  });

  it("passes the isError flag and the text of a result to the SDK", async () => {
    const harness = createHarness({
      script: scriptOf([
        [
          { kind: "tools", calls: [{ name: "get_word" }] },
          { kind: "text", text: "done" },
        ],
      ]),
    });
    const messages = [systemMessage([getWord]), userMessage("go")];
    const first = await ask(harness, messages);
    const [call] = toolCallsOf(first.message);
    await ask(harness, [...messages, first.message, toolResultFor(call as never, "boom", true)]);
    expect(harness.fake.queries[0]?.toolResults).toEqual([
      { toolUseId: call?.id, text: "boom", isError: true },
    ]);
  });

  it("answers a message after end_turn in the live query", async () => {
    const harness = createHarness({
      script: scriptOf([[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]]),
    });
    const messages = [systemMessage(), userMessage("a")];
    const first = await ask(harness, messages);
    const second = await ask(harness, [...messages, first.message, userMessage("b")]);
    expect(textOfMessage(second.message)).toBe("two");
    expect(harness.fake.queries).toHaveLength(1);
    expect(harness.fake.queries[0]?.inputs).toEqual(["a", "b"]);
  });

  it("changes the model with setModel and keeps the process", async () => {
    const harness = createHarness({ script: scriptOf([[{ kind: "text", text: "x" }]]) });
    const messages = [systemMessage(), userMessage("a")];
    const first = await ask(harness, messages);
    await ask(
      harness,
      [...messages, first.message, userMessage("b")],
      { sessionId: "thread-1" },
      {
        ...(await import("./test-support")).FAKE_MODEL,
        id: "sonnet",
      },
    );
    expect(harness.fake.queries).toHaveLength(1);
    expect(harness.fake.queries[0]?.models).toEqual(["sonnet"]);
  });

  it("answers a call with no tools as a one-shot: fresh query, nothing saved, one turn", async () => {
    const harness = createHarness({ script: scriptOf([[{ kind: "text", text: "title" }]]) });
    const { message } = await ask(harness, [systemMessage([]), userMessage("name this")], {});
    expect(textOfMessage(message)).toBe("title");
    const [record] = harness.fake.queries;
    expect(record?.options).toMatchObject({ persistSession: false, maxTurns: 1, tools: [] });
    expect(record?.options.toolHost).toBeUndefined();
    expect(record?.inputs).toEqual(["name this"]);
    expect(record?.closed).toBe(true);
    await ask(harness, [systemMessage([]), userMessage("again")], { sessionId: "thread-1" });
    expect(harness.fake.queries).toHaveLength(2);
  });

  it("reports the number of live processes", async () => {
    const harness = createHarness();
    await ask(harness, [systemMessage(), userMessage("a")]);
    expect(harness.streamer.processCount()).toBe(1);
    await harness.streamer.closeThread("thread-1");
    expect(harness.streamer.processCount()).toBe(0);
    expect(harness.processCounts).toEqual([1, 0]);
  });

  it("notes the context window from the result", async () => {
    const harness = createHarness();
    await ask(harness, [systemMessage(), userMessage("a")]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.contextWindows[0]).toEqual(["haiku", 1_000_000]);
  });

  it("keeps two tools declared as MCP tools without the prefix", async () => {
    const harness = createHarness();
    await ask(harness, [systemMessage([getWord, getNumber]), userMessage("a")]);
    const host = harness.fake.queries[0]?.options.toolHost;
    expect(host?.listTools().map((tool) => tool.name)).toEqual(["get_word", "get_number"]);
  });
});
