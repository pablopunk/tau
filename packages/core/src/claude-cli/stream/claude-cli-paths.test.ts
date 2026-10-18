import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { scriptOf } from "../testing/fake-claude-script";
import { toMcpResult } from "./content";
import { IDLE_CLOSE_MS } from "./lifecycle";
import { renderRebindTranscript } from "./rebind-transcript";
import {
  ask,
  createHarness,
  getNumber,
  getWord,
  type Harness,
  modelNamed,
  systemMessage,
  textOfMessage,
  toolCallsOf,
  toolResultFor,
  userMessage,
  waitFor,
} from "./test-support";

const say = (text: string) => [{ kind: "text" as const, text }];

async function twoTurns(harness: Harness) {
  const base = [systemMessage(), userMessage("a")];
  const first = await ask(harness, base);
  const second = await ask(harness, [...base, first.message, userMessage("b")]);
  return { base, first: first.message, second: second.message };
}

const sessionOf = (harness: Harness, index: number) => harness.fake.queries[index]?.sessionId;

describe("Pi operations pick their path", () => {
  it("idle more than 15 minutes, then a message: Resume with the same session id", async () => {
    const harness = createHarness({ script: scriptOf([say("one"), say("two")]) });
    const base = [systemMessage(), userMessage("a")];
    const first = await ask(harness, base);
    harness.clock.advance(IDLE_CLOSE_MS + 1);
    expect(harness.fake.queries[0]?.closed).toBe(true);
    await ask(harness, [...base, first.message, userMessage("b")]);
    const [, resumed] = harness.fake.queries;
    expect(resumed?.options.resume).toBe(sessionOf(harness, 0));
    expect(resumed?.options.forkSession).toBeUndefined();
    expect(resumed?.inputs).toEqual(["b"]);
  });

  it("a thread with a parked handler never closes for idle", async () => {
    const harness = createHarness({ script: scriptOf([[{ kind: "tools", calls: [{ name: "get_word" }] }]]) });
    await ask(harness, [systemMessage(), userMessage("go")]);
    harness.clock.advance(IDLE_CLOSE_MS * 2);
    expect(harness.fake.queries[0]?.closed).toBe(false);
  });

  it("a new system prompt: Rebind with the transcript as the first message", async () => {
    const harness = createHarness({ script: scriptOf([say("one"), say("two")]) });
    const base = [systemMessage(), userMessage("a")];
    const first = await ask(harness, base);
    await ask(harness, [
      systemMessage([getWord, getNumber], "changed"),
      userMessage("a"),
      first.message,
      userMessage("b"),
    ]);
    expect(harness.fake.queries).toHaveLength(2);
    expect(harness.fake.queries[1]?.options.resume).toBeUndefined();
    expect(harness.fake.queries[1]?.inputs[0]).toContain("<conversation-so-far>");
    expect(harness.fake.queries[1]?.inputs[0]).toContain("one");
    expect(harness.fake.deletedSessions).toEqual([sessionOf(harness, 0)]);
  });

  it("tools added or removed: Rebind", async () => {
    const harness = createHarness({ script: scriptOf([say("one"), say("two")]) });
    const base = [systemMessage([getWord]), userMessage("a")];
    const first = await ask(harness, base);
    const added: Message = { role: "system", content: "", toolsAdded: [getNumber], timestamp: 5 };
    await ask(harness, [...base, first.message, added, userMessage("b")]);
    expect(harness.fake.queries).toHaveLength(2);
    expect(harness.fake.queries[1]?.options.toolHost?.listTools().map((tool) => tool.name)).toEqual([
      "get_word",
      "get_number",
    ]);
    expect(harness.fake.queries[1]?.inputs[0]).toContain("<conversation-so-far>");
  });

  it("a fork (new Pi session id) with history: Rebind", async () => {
    const harness = createHarness({ script: scriptOf([say("one"), say("two")]) });
    const base = [systemMessage(), userMessage("a")];
    const first = await ask(harness, base);
    await ask(harness, [...base, first.message, userMessage("b")], { sessionId: "fork-1" });
    expect(harness.fake.queries).toHaveLength(2);
    expect(harness.fake.queries[1]?.inputs[0]).toContain("<conversation-so-far>");
    expect(harness.fake.deletedSessions).toEqual([]);
  });

  it("a switch from another provider (history, no binding): Rebind", async () => {
    const harness = createHarness({ script: scriptOf([say("two")]) });
    const history: AssistantMessage = {
      ...(
        await ask(createHarness({ script: scriptOf([say("earlier")]) }), [systemMessage(), userMessage("a")])
      ).message,
    };
    await ask(harness, [systemMessage(), userMessage("a"), history, userMessage("b")]);
    expect(harness.fake.queries[0]?.options.resume).toBeUndefined();
    expect(harness.fake.queries[0]?.inputs[0]).toContain("earlier");
  });

  it("a model change keeps the process (Continue after setModel)", async () => {
    const harness = createHarness({ script: scriptOf([say("one"), say("two")]) });
    const base = [systemMessage(), userMessage("a")];
    const first = await ask(harness, base);
    await ask(
      harness,
      [...base, first.message, userMessage("b")],
      { sessionId: "thread-1" },
      modelNamed("sonnet"),
    );
    expect(harness.fake.queries).toHaveLength(1);
    expect(harness.fake.queries[0]?.models).toEqual(["sonnet"]);
  });

  it("an effort change: Resume with the new effort, never applyFlagSettings", async () => {
    const harness = createHarness({ script: scriptOf([say("one"), say("two")]) });
    const base = [systemMessage(), userMessage("a")];
    const first = await ask(harness, base, { sessionId: "thread-1", reasoning: "low" });
    await ask(harness, [...base, first.message, userMessage("b")], {
      sessionId: "thread-1",
      reasoning: "high",
    });
    expect(harness.fake.queries).toHaveLength(2);
    expect(harness.fake.queries[0]?.options.effort).toBe("low");
    expect(harness.fake.queries[1]?.options.effort).toBe("high");
    expect(harness.fake.queries[1]?.options.resume).toBe(sessionOf(harness, 0));
    expect(harness.fake.queries.flatMap((query) => query.flags)).toEqual([]);
  });

  it("minimal reasoning is low", async () => {
    const harness = createHarness();
    await ask(harness, [systemMessage(), userMessage("a")], { sessionId: "thread-1", reasoning: "minimal" });
    expect(harness.fake.queries[0]?.options.effort).toBe("low");
  });

  it("a retry after an error: Resume-at the checkpoint before the failed request, old session deleted", async () => {
    const harness = createHarness({
      script: (turn, firstText) => say(firstText === "b" ? "retried" : turn === 0 ? "one" : "two"),
    });
    const { base, first } = await twoTurns(harness);
    const retry = await ask(harness, [...base, first, userMessage("b")]);
    expect(textOfMessage(retry.message)).toBe("retried");
    const resumed = harness.fake.queries[1];
    expect(harness.fake.queries).toHaveLength(2);
    expect(resumed?.options.forkSession).toBe(true);
    expect(resumed?.options.resume).toBe(sessionOf(harness, 0));
    expect(resumed?.options.resumeSessionAt).toBeDefined();
    expect(harness.fake.queries[0]?.closed).toBe(true);
    await waitFor(() => harness.fake.deletedSessions.length === 1);
    expect(harness.fake.deletedSessions).toEqual([sessionOf(harness, 0)]);
  });

  it("a retry with no checkpoint in memory: Rebind", async () => {
    const harness = createHarness({ script: scriptOf([say("one"), say("two")]) });
    const base = [systemMessage(), userMessage("a")];
    await ask(harness, base);
    const stranger = (await ask(createHarness(), [systemMessage(), userMessage("zzz")])).message;
    await ask(harness, [...base, stranger, userMessage("b")]);
    expect(harness.fake.queries[1]?.options.resume).toBeUndefined();
    expect(harness.fake.queries[1]?.inputs[0]).toContain("<conversation-so-far>");
  });

  it("after a restart (empty bindings) with history: Rebind", async () => {
    const harness = createHarness({ script: scriptOf([say("one"), say("two")]) });
    const base = [systemMessage(), userMessage("a")];
    const first = await ask(harness, base);
    const restarted = createHarness({ script: scriptOf([say("two")]) });
    await ask(restarted, [...base, first.message, userMessage("b")]);
    expect(restarted.fake.queries[0]?.options.resume).toBeUndefined();
    expect(restarted.fake.queries[0]?.inputs[0]).toContain("<conversation-so-far>");
  });

  it("a compacted transcript (summary replaces history): Rebind", async () => {
    const harness = createHarness({ script: scriptOf([say("one"), say("two")]) });
    const base = [systemMessage(), userMessage("a")];
    await ask(harness, base);
    await ask(harness, [systemMessage(), userMessage("summary of everything"), userMessage("b")]);
    expect(harness.fake.queries[1]?.options.resume).toBeUndefined();
  });
});

describe("abort", () => {
  const toolRound = scriptOf([[{ kind: "tools", calls: [{ name: "get_word" }] }], say("after")]);

  function abortingHarness(controller: AbortController) {
    return createHarness({
      script: toolRound,
      wrap: (port) => ({
        ...port,
        startQuery(options) {
          const query = port.startQuery(options);
          queueMicrotask(() => controller.abort());
          return query;
        },
      }),
    });
  }

  it("interrupts, never aborts the controller, and ends aborted", async () => {
    const controller = new AbortController();
    const harness = abortingHarness(controller);
    const { events, message } = await ask(harness, [systemMessage(), userMessage("go")], {
      sessionId: "thread-1",
      signal: controller.signal,
    });
    expect(message.stopReason).toBe("aborted");
    expect(events.at(-1)).toMatchObject({ type: "error", reason: "aborted" });
    expect(harness.fake.queries[0]?.interrupts).toBeGreaterThan(0);
    expect(Object.keys(harness.fake.queries[0]?.options ?? {})).not.toContain("abortController");
  });

  it("a message after Stop in a tool: interrupt the parked call, Continue in the same process", async () => {
    const harness = createHarness({ script: toolRound });
    const base = [systemMessage(), userMessage("go")];
    const round = await ask(harness, base);
    const [call] = toolCallsOf(round.message);
    const abortedResult = toolResultFor(call as never, "Tool execution was aborted", true);
    const next = await ask(harness, [...base, round.message, abortedResult, userMessage("again")]);
    expect(harness.fake.queries).toHaveLength(1);
    expect(harness.fake.queries[0]?.interrupts).toBeGreaterThan(0);
    expect(textOfMessage(next.message)).toBe("after");
    expect(harness.fake.queries[0]?.inputs.at(-1)).toBe("again");
  });

  it("an already aborted signal ends at once without a query", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    controller.abort();
    const { message } = await ask(harness, [systemMessage(), userMessage("a")], {
      sessionId: "thread-1",
      signal: controller.signal,
    });
    expect(message.stopReason).toBe("aborted");
    expect(harness.fake.queries).toHaveLength(0);
  });
});

describe("delivery", () => {
  it("results first, then the steer, folded into the same turn", async () => {
    const harness = createHarness({
      script: scriptOf([
        [
          { kind: "tools", calls: [{ name: "get_word" }] },
          { kind: "text", text: "done" },
        ],
      ]),
    });
    const base = [systemMessage(), userMessage("go")];
    const first = await ask(harness, base);
    const [call] = toolCallsOf(first.message);
    const second = await ask(harness, [
      ...base,
      first.message,
      toolResultFor(call as never, "banana"),
      userMessage("steer"),
    ]);
    expect(textOfMessage(second.message)).toBe("done");
    expect(harness.fake.queries).toHaveLength(1);
    expect(harness.fake.queries[0]?.toolResults.map((result) => result.text)).toEqual(["banana"]);
    expect(harness.fake.queries[0]?.folded.flatMap((fold) => fold.texts)).toEqual(["steer"]);
  });
});

describe("errors and safety", () => {
  it("maps a plan limit to a clear text and an error stop", async () => {
    const harness = createHarness({ script: scriptOf([[{ kind: "error", code: "rate_limit" }]]) });
    const { message } = await ask(harness, [systemMessage(), userMessage("a")]);
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toContain("Plan limit reached");
  });

  it("an auth error asks the detector to check again and says nothing about Claude Code", async () => {
    const harness = createHarness({ script: scriptOf([[{ kind: "error", code: "oauth_org_not_allowed" }]]) });
    const { message } = await ask(harness, [systemMessage(), userMessage("a")]);
    expect(message.stopReason).toBe("error");
    expect(harness.authErrors).toHaveLength(1);
    expect(message.errorMessage).not.toMatch(/Claude Code/i);
  });

  it("overloaded is an error Pi can retry", async () => {
    const harness = createHarness({ script: scriptOf([[{ kind: "error", code: "overloaded" }]]) });
    const { message } = await ask(harness, [systemMessage(), userMessage("a")]);
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toContain("overloaded");
  });

  it("stops the run when the API key source is not none", async () => {
    const harness = createHarness({ apiKeySource: "ANTHROPIC_API_KEY" });
    const { message } = await ask(harness, [systemMessage(), userMessage("a")]);
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toContain("API key");
  });

  it("every query is locked down and gets no API key in env", async () => {
    const harness = createHarness({
      env: { PATH: "/bin", ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t" },
      script: scriptOf([say("one"), say("two")]),
    });
    await ask(harness, [systemMessage(), userMessage("a")]);
    await ask(harness, [systemMessage([]), userMessage("title")], {});
    expect(harness.fake.queries).toHaveLength(2);
    for (const { options } of harness.fake.queries) {
      expect(options.strictMcpConfig).toBe(true);
      expect(options.settings.disableClaudeAiConnectors).toBe(true);
      expect(options.tools).toEqual([]);
      expect(options.env).toEqual({ PATH: "/bin" });
    }
  });

  it("records the rate limit events", async () => {
    const harness = createHarness({
      script: scriptOf([
        [
          { kind: "rateLimit", limit: { status: "allowed_warning", fiveHour: 0.8, resetsAt: 123 } },
          { kind: "text", text: "x" },
        ],
      ]),
    });
    await ask(harness, [systemMessage(), userMessage("a")]);
    await waitFor(() => harness.usage.length > 0);
    expect(harness.usage[0]).toMatchObject({ status: "allowed_warning" });
  });
});

describe("closing", () => {
  it("closeThread closes the query and deletes the sessions tau created", async () => {
    const harness = createHarness();
    await ask(harness, [systemMessage(), userMessage("a")]);
    await harness.streamer.closeThread("thread-1");
    expect(harness.fake.queries[0]?.closed).toBe(true);
    expect(harness.fake.deletedSessions).toEqual([sessionOf(harness, 0)]);
  });

  it("closeAll closes every live query", async () => {
    const harness = createHarness();
    await ask(harness, [systemMessage(), userMessage("a")], { sessionId: "one" });
    await ask(harness, [systemMessage(), userMessage("a")], { sessionId: "two" });
    await harness.streamer.closeAll();
    expect(harness.fake.queries.every((query) => query.closed)).toBe(true);
  });
});

describe("content", () => {
  it("builds the MCP result with text, image and the error flag", () => {
    const result = toMcpResult({
      role: "toolResult",
      toolCallId: "t",
      toolName: "x",
      content: [
        { type: "text", text: "hi" },
        { type: "image", data: "AAA", mimeType: "image/png" },
      ],
      isError: true,
      timestamp: 1,
    });
    expect(result).toEqual({
      content: [
        { type: "text", text: "hi" },
        { type: "image", data: "AAA", mimeType: "image/png" },
      ],
      isError: true,
    });
  });

  it("cuts tool results to 4000 characters with the marker and keeps them in the transcript", () => {
    const long = "x".repeat(4500);
    const call = { type: "toolCall", id: "c1", name: "get_word", arguments: {} };
    const text = renderRebindTranscript([
      { message: { role: "user", content: "go", timestamp: 1 }, hash: "h1" },
      {
        message: {
          role: "assistant",
          content: [call],
          stopReason: "toolUse",
          timestamp: 2,
        } as unknown as AssistantMessage,
        hash: "h2",
      },
      {
        message: toolResultFor(call as never, long),
        hash: "h3",
      },
    ] as never);
    expect(text).toContain("[truncated 500 characters]");
    expect(text).toContain("x".repeat(4000));
    expect(text).not.toContain("x".repeat(4001));
    expect(text).toContain("[tool call get_word (c1)]");
  });
});
