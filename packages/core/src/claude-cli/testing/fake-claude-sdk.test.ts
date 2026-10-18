import { describe, expect, it } from "vitest";
import { createClaudeInput } from "../claude-input";
import type {
  ClaudeQuery,
  ClaudeQueryOptions,
  ClaudeSdkMessage,
  ClaudeToolHost,
  ClaudeToolResult,
} from "../sdk-types";
import { type FakeScript, scriptOf } from "./fake-claude-script";
import { createFakeClaudeSdk } from "./fake-claude-sdk";

interface Parked {
  readonly name: string;
  readonly toolUseId: string;
  resolve(text: string): void;
}

function parkingHost(): { host: ClaudeToolHost; parked: Parked[]; order: string[] } {
  const parked: Parked[] = [];
  const order: string[] = [];
  const host: ClaudeToolHost = {
    listTools: () => [{ name: "get_word", description: "word", inputSchema: { type: "object" } }],
    callTool: (call) =>
      new Promise<ClaudeToolResult>((resolve) => {
        order.push(call.name);
        parked.push({
          name: call.name,
          toolUseId: call.toolUseId,
          resolve: (text) => resolve({ content: [{ type: "text", text }], isError: false }),
        });
      }),
    onToolsChanged: () => () => undefined,
  };
  return { host, parked, order };
}

const baseOptions = (overrides: Partial<ClaudeQueryOptions> = {}): ClaudeQueryOptions => ({
  prompt: "hello",
  model: "haiku",
  cwd: "/tmp",
  systemPrompt: "test",
  env: {},
  title: "tau · test",
  tools: [],
  strictMcpConfig: true,
  settingSources: [],
  settings: { disableClaudeAiConnectors: true, autoCompactEnabled: false },
  permissionMode: "dontAsk",
  allowedTools: ["mcp__tau__*"],
  includePartialMessages: true,
  ...overrides,
});

async function collectUntilResults(query: ClaudeQuery, count: number): Promise<ClaudeSdkMessage[]> {
  const seen: ClaudeSdkMessage[] = [];
  let results = 0;
  for await (const message of query) {
    seen.push(message);
    if (message.type === "result" && ++results === count) break;
  }
  return seen;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt++) await tick();
  expect(predicate()).toBe(true);
};

const twoTools: FakeScript = scriptOf([
  [
    { kind: "tools", calls: [{ name: "get_word" }, { name: "get_number" }] },
    { kind: "text", text: "banana 42" },
  ],
]);

describe("fake Claude SDK", () => {
  it("streams a text turn as stream events, one assistant message per block and a result", async () => {
    const fake = createFakeClaudeSdk({ script: scriptOf([[{ kind: "text", text: "hi", thinking: "hm" }]]) });
    const messages = await collectUntilResults(fake.port.startQuery(baseOptions()), 1);
    const types = messages.map((message) => message.type);
    expect(types[0]).toBe("system");
    expect(messages[0]).toMatchObject({ subtype: "init", apiKeySource: "none" });
    expect(types.filter((type) => type === "assistant")).toHaveLength(2);
    expect(
      messages.some((m) => m.type === "stream_event" && JSON.stringify(m).includes("thinking_delta")),
    ).toBe(true);
    expect(messages.at(-1)).toMatchObject({ type: "result", subtype: "success" });
  });

  it("calls tool handlers one after the other, not in parallel", async () => {
    const fake = createFakeClaudeSdk({ script: twoTools });
    const { host, parked, order } = parkingHost();
    const done = collectUntilResults(fake.port.startQuery(baseOptions({ toolHost: host })), 1);
    await waitFor(() => parked.length === 1);
    expect(order).toEqual(["get_word"]);
    parked[0]?.resolve("banana");
    await waitFor(() => parked.length === 2);
    expect(order).toEqual(["get_word", "get_number"]);
    parked[1]?.resolve("42");
    const messages = await done;
    const results = messages.filter((m) => m.type === "user");
    expect(results).toHaveLength(2);
    expect(fake.queries[0]?.toolResults.map((r) => r.text)).toEqual(["banana", "42"]);
  });

  it("interrupt ends the turn with interrupted results and keeps the query for the next message", async () => {
    const fake = createFakeClaudeSdk({
      script: scriptOf([
        [{ kind: "tools", calls: [{ name: "get_word" }, { name: "get_number" }] }],
        [{ kind: "text", text: "back" }],
      ]),
    });
    const { host, parked } = parkingHost();
    const input = createClaudeInput();
    input.push("go");
    const query = fake.port.startQuery(baseOptions({ prompt: input.stream, toolHost: host }));
    const done = collectUntilResults(query, 2);
    await waitFor(() => parked.length === 1);
    await query.interrupt();
    await tick();
    input.push("again");
    const messages = await done;
    const interrupted = messages.filter((m) => m.type === "result")[0];
    expect(interrupted).toMatchObject({
      subtype: "error_during_execution",
      terminal_reason: "aborted_tools",
    });
    expect(fake.queries[0]?.toolResults.every((r) => r.isError)).toBe(true);
    expect(fake.queries[0]?.toolResults).toHaveLength(2);
    expect(parked).toHaveLength(1);
    expect(messages.at(-1)).toMatchObject({ type: "result", subtype: "success" });
    input.close();
  });

  it("folds a user message pushed during a tool round into the same turn", async () => {
    const fake = createFakeClaudeSdk({ script: twoTools });
    const { host, parked } = parkingHost();
    const input = createClaudeInput();
    input.push("go");
    const done = collectUntilResults(
      fake.port.startQuery(baseOptions({ prompt: input.stream, toolHost: host })),
      1,
    );
    await waitFor(() => parked.length === 1);
    input.push("also do this");
    await tick();
    parked[0]?.resolve("banana");
    await waitFor(() => parked.length === 2);
    parked[1]?.resolve("42");
    await done;
    expect(fake.queries[0]?.folded).toEqual([{ turnIndex: 0, texts: ["also do this"] }]);
    input.close();
  });

  it("starts a new turn for a message that arrives after end_turn", async () => {
    const fake = createFakeClaudeSdk({
      script: scriptOf([[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]]),
    });
    const input = createClaudeInput();
    input.push("first");
    const query = fake.port.startQuery(baseOptions({ prompt: input.stream }));
    const done = collectUntilResults(query, 2);
    await tick();
    input.push("second");
    await done;
    expect(fake.queries[0]?.folded).toEqual([]);
    input.close();
  });

  it("emits rate_limit_event with the subscription shape", async () => {
    const fake = createFakeClaudeSdk({
      script: scriptOf([
        [
          { kind: "rateLimit", limit: { status: "allowed_warning", fiveHour: 0.81, resetsAt: 1_800_000 } },
          { kind: "text", text: "ok" },
        ],
      ]),
    });
    const messages = await collectUntilResults(fake.port.startQuery(baseOptions()), 1);
    expect(messages.find((m) => m.type === "rate_limit_event")).toMatchObject({
      rate_limit_info: { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.81 },
    });
  });

  it("reports an error code on the assistant message and an error result", async () => {
    const fake = createFakeClaudeSdk({
      script: scriptOf([[{ kind: "error", code: "oauth_org_not_allowed" }]]),
    });
    const messages = await collectUntilResults(fake.port.startQuery(baseOptions()), 1);
    expect(messages.find((m) => m.type === "assistant")).toMatchObject({ error: "oauth_org_not_allowed" });
    expect(messages.at(-1)).toMatchObject({ type: "result", is_error: true });
  });

  it("records options, forks sessions and tracks deleted sessions", async () => {
    const fake = createFakeClaudeSdk();
    const first = fake.port.startQuery(baseOptions());
    const forked = fake.port.startQuery(
      baseOptions({ resume: "fake-session-1", forkSession: true, resumeSessionAt: "u1" }),
    );
    first.close();
    forked.close();
    expect(fake.queries[0]?.sessionId).toBe("fake-session-1");
    expect(fake.queries[1]?.sessionId).not.toBe("fake-session-1");
    expect(fake.queries[1]?.options).toMatchObject({ resumeSessionAt: "u1", strictMcpConfig: true });
    await fake.port.deleteSession("fake-session-1");
    expect(fake.deletedSessions).toEqual(["fake-session-1"]);
  });

  it("reports the apiKeySource it is told to", async () => {
    const fake = createFakeClaudeSdk({ apiKeySource: "ANTHROPIC_API_KEY" });
    const [init] = await collectUntilResults(fake.port.startQuery(baseOptions()), 1);
    expect(init).toMatchObject({ apiKeySource: "ANTHROPIC_API_KEY" });
  });
});
