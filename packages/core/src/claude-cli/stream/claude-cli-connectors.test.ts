import type { ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { CONNECTOR_TOOL_NAME } from "../connectors/names";
import type { ClaudeQueryOptions } from "../sdk-types";
import { scriptOf } from "../testing/fake-claude-script";
import {
  advanceUntil,
  connectedStatuses,
  connectorHarness,
  connectorStep,
  createFakeApprovals,
  LINEAR,
  linearOnly,
  SLACK,
} from "./connector-support";
import {
  ask,
  createHarness,
  getWord,
  systemMessage,
  textOfMessage,
  toolCallsOf,
  toolResultFor,
  userMessage,
  waitFor,
} from "./test-support";

const base = () => [systemMessage(), userMessage("go")];

const oneConnectorThenText = scriptOf([
  [connectorStep("list_teams", "33"), { kind: "text", text: "teams: 33" }],
  [{ kind: "text", text: "two" }],
]);

describe("query options", () => {
  it("keeps the locked-down options when no connector is chosen", async () => {
    const harness = createHarness();
    await ask(harness, base());
    const options = harness.fake.queries[0]?.options as ClaudeQueryOptions;
    expect(options).toMatchObject({ strictMcpConfig: true, permissionMode: "dontAsk" });
    expect(options.settings.disableClaudeAiConnectors).toBe(true);
    expect(options.canUseTool).toBeUndefined();
    expect(options.disallowedTools).toBeUndefined();
  });

  it("opens the connectors with exact read-only names, no server glob and the others disallowed", async () => {
    const harness = connectorHarness({
      connectorSettings: { enabled: [LINEAR], alwaysAllow: ["mcp__claude_ai_Linear__save_comment"] },
    });
    await ask(harness, base());
    const options = harness.fake.queries[0]?.options as ClaudeQueryOptions;
    expect(options).toMatchObject({ strictMcpConfig: false, permissionMode: "default" });
    expect(options.settings.disableClaudeAiConnectors).toBe(false);
    expect(options.allowedTools).toEqual([
      "mcp__tau__*",
      "mcp__claude_ai_Linear__list_teams",
      "mcp__claude_ai_Linear__get_issue",
      "mcp__claude_ai_Linear__save_comment",
    ]);
    expect(options.allowedTools.some((name) => name.includes("Linear__*"))).toBe(false);
    expect(options.disallowedTools).toEqual(["mcp__claude_ai_Slack__*", "mcp__claude_ai_Notion__*"]);
    expect(options.canUseTool).toBeTypeOf("function");
    expect(harness.fake.queries[0]?.toggles).toEqual([]);
  });

  it("leaves always-allowed tools of servers that are not chosen out of allowedTools", async () => {
    const harness = connectorHarness({
      connectorSettings: { enabled: [LINEAR], alwaysAllow: ["mcp__claude_ai_Slack__slack_send_message"] },
    });
    await ask(harness, base());
    const options = harness.fake.queries[0]?.options;
    expect(options?.allowedTools).not.toContain("mcp__claude_ai_Slack__slack_send_message");
  });
});

describe("observed connector calls", () => {
  it("maps a connector tool_use to claude_connector and back, with the CLI result untouched", async () => {
    const harness = connectorHarness({ script: oneConnectorThenText });
    const first = await ask(harness, base());
    const [call] = toolCallsOf(first.message);
    expect(first.message.stopReason).toBe("toolUse");
    expect(call).toMatchObject({
      name: CONNECTOR_TOOL_NAME,
      arguments: { server: "Linear", tool: "list_teams", arguments: {} },
    });
    await waitFor(() => harness.observed.settled.has(call?.id ?? ""));
    expect(harness.observed.settled.get(call?.id ?? "")).toEqual({
      content: [{ type: "text", text: "33" }],
      isError: false,
    });
  });

  it("drains the CLI's own next message and never sends the connector result to the CLI", async () => {
    const harness = connectorHarness({ script: oneConnectorThenText });
    const messages = base();
    const first = await ask(harness, messages);
    const [call] = toolCallsOf(first.message);
    await waitFor(() => harness.observed.settled.size === 1);
    const second = await ask(harness, [...messages, first.message, toolResultFor(call as ToolCall, "33")]);
    expect(textOfMessage(second.message)).toBe("teams: 33");
    expect(second.message.stopReason).toBe("stop");
    expect(harness.fake.queries).toHaveLength(1);
    expect(harness.fake.queries[0]?.inputs).toEqual(["go"]);
    const third = await ask(harness, [
      ...messages,
      first.message,
      toolResultFor(call as ToolCall, "33"),
      second.message,
      userMessage("more"),
    ]);
    expect(textOfMessage(third.message)).toBe("two");
    expect(harness.fake.queries[0]?.inputs).toEqual(["go", "more"]);
  });

  it("drains one API message per turn and keeps the rest queued", async () => {
    const harness = connectorHarness({
      script: scriptOf([
        [
          connectorStep("list_teams", "one"),
          connectorStep("get_issue", "two"),
          { kind: "text", text: "all done" },
        ],
      ]),
    });
    const messages = base();
    const first = await ask(harness, messages);
    const [callOne] = toolCallsOf(first.message);
    await waitFor(() => harness.observed.settled.size === 2);
    const second = await ask(harness, [
      ...messages,
      first.message,
      toolResultFor(callOne as ToolCall, "one"),
    ]);
    expect(second.message.stopReason).toBe("toolUse");
    const [callTwo] = toolCallsOf(second.message);
    expect(callTwo).toMatchObject({ arguments: { tool: "get_issue" } });
    const third = await ask(harness, [
      ...messages,
      first.message,
      toolResultFor(callOne as ToolCall, "one"),
      second.message,
      toolResultFor(callTwo as ToolCall, "two"),
    ]);
    expect(textOfMessage(third.message)).toBe("all done");
    expect(harness.fake.queries[0]?.inputs).toEqual(["go"]);
  });

  it("settles a result that comes after the stream ended (late)", async () => {
    const harness = connectorHarness({
      script: scriptOf([
        [connectorStep("list_teams", "late", { delayMs: 30 }), { kind: "text", text: "ok" }],
      ]),
    });
    const first = await ask(harness, base());
    const [call] = toolCallsOf(first.message);
    expect(harness.observed.settled.has(call?.id ?? "")).toBe(false);
    await waitFor(() => harness.observed.settled.has(call?.id ?? ""));
    expect(harness.observed.settled.get(call?.id ?? "")?.content).toEqual([{ type: "text", text: "late" }]);
  });

  it("passes the isError flag of a connector result through", async () => {
    const harness = connectorHarness({
      script: scriptOf([
        [connectorStep("list_teams", "nope", { isError: true }), { kind: "text", text: "x" }],
      ]),
    });
    const first = await ask(harness, base());
    const [call] = toolCallsOf(first.message);
    await waitFor(() => harness.observed.settled.has(call?.id ?? ""));
    expect(harness.observed.settled.get(call?.id ?? "")?.isError).toBe(true);
  });

  it("answers a mixed message: tau results go to the CLI, the connector result does not", async () => {
    const harness = connectorHarness({
      script: scriptOf([
        [
          {
            kind: "tools",
            calls: [
              { name: "get_word" },
              {
                name: "list_teams",
                connector: { server: LINEAR, result: "33" },
              },
            ],
          },
          { kind: "text", text: "banana 33" },
        ],
      ]),
    });
    const messages = [systemMessage([getWord]), userMessage("go")];
    const first = await ask(harness, messages);
    const [tau, connector] = toolCallsOf(first.message);
    expect(connector?.name).toBe(CONNECTOR_TOOL_NAME);
    const second = await ask(harness, [
      ...messages,
      first.message,
      toolResultFor(tau as ToolCall, "banana"),
      toolResultFor(connector as ToolCall, "33"),
    ]);
    expect(textOfMessage(second.message)).toBe("banana 33");
    const texts = harness.fake.queries[0]?.toolResults.map((result) => result.text);
    expect(texts).toEqual(["banana", "33"]);
    expect(harness.fake.queries[0]?.inputs).toEqual(["go"]);
  });
});

describe("hash and options", () => {
  it("ignores a system entry that only adds claude_connector", async () => {
    const harness = connectorHarness({
      script: scriptOf([[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]]),
    });
    const messages = base();
    const first = await ask(harness, messages);
    const connectorTool = {
      name: CONNECTOR_TOOL_NAME,
      description: "d",
      parameters: { type: "object", properties: {} },
    };
    const addConnector = { ...systemMessage([connectorTool as never], ""), timestamp: 5 };
    const second = await ask(harness, [...messages, first.message, addConnector, userMessage("again")]);
    expect(textOfMessage(second.message)).toBe("b");
    expect(harness.fake.queries).toHaveLength(1);
  });

  it("does not offer claude_connector to the CLI as a tau tool", async () => {
    const harness = connectorHarness();
    const connectorTool = {
      name: CONNECTOR_TOOL_NAME,
      description: "d",
      parameters: { type: "object", properties: {} },
    };
    await ask(harness, [systemMessage([getWord, connectorTool as never]), userMessage("hi")]);
    const host = harness.fake.queries[0]?.options.toolHost;
    expect(host?.listTools().map((tool) => tool.name)).toEqual(["get_word"]);
  });

  it("closes an idle query when the chosen servers change and resumes with the new options", async () => {
    const harness = connectorHarness({
      connectorSettings: { enabled: [], alwaysAllow: [] },
      script: scriptOf([[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]]),
    });
    const messages = base();
    const first = await ask(harness, messages);
    harness.setConnectorSettings(linearOnly);
    await ask(harness, [...messages, first.message, userMessage("again")]);
    const [one, two] = harness.fake.queries;
    expect(one?.closed).toBe(true);
    expect(one?.options.strictMcpConfig).toBe(true);
    expect(two?.options.resume).toBe(one?.sessionId);
    expect(two?.options.strictMcpConfig).toBe(false);
  });

  it("never closes a busy query for a changed choice", async () => {
    const harness = connectorHarness({
      connectorSettings: { enabled: [], alwaysAllow: [] },
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
    harness.setConnectorSettings(linearOnly);
    await ask(harness, [...messages, first.message, toolResultFor(call as ToolCall, "banana")]);
    expect(harness.fake.queries).toHaveLength(1);
    expect(harness.fake.queries[0]?.closed).toBe(false);
  });
});

describe("resume after a close", () => {
  it("sends Continue. when the SDK session ends in a connector result", async () => {
    const harness = connectorHarness({ script: scriptOf([[connectorStep("list_teams", "33")]]) });
    const messages = base();
    const first = await ask(harness, messages);
    const [call] = toolCallsOf(first.message);
    await waitFor(() => harness.observed.settled.size === 1);
    harness.clock.advance(16 * 60 * 1000);
    await waitFor(() => harness.fake.queries[0]?.closed === true);
    await ask(harness, [...messages, first.message, toolResultFor(call as ToolCall, "33")]);
    const second = harness.fake.queries[1];
    expect(second?.options.resume).toBe(harness.fake.queries[0]?.sessionId);
    expect(second?.inputs).toEqual(["Continue."]);
  });

  it("rebinds with the connector call rendered as text when the session did not end in a result", async () => {
    const harness = connectorHarness({
      script: scriptOf([
        [connectorStep("list_teams", "33"), { kind: "text", text: "teams" }],
        [{ kind: "text", text: "x" }],
      ]),
    });
    const messages = base();
    const first = await ask(harness, messages);
    const [call] = toolCallsOf(first.message);
    const second = await ask(harness, [...messages, first.message, toolResultFor(call as ToolCall, "33")]);
    harness.clock.advance(16 * 60 * 1000);
    await waitFor(() => harness.fake.queries[0]?.closed === true);
    await ask(harness, [
      ...messages,
      first.message,
      toolResultFor(call as ToolCall, "33"),
      second.message,
      userMessage("more"),
    ]);
    expect(harness.fake.queries[1]?.options.resume).toBe(harness.fake.queries[0]?.sessionId);
    expect(harness.fake.queries[1]?.inputs).toEqual(["more"]);
  });
});

describe("approvals bridge", () => {
  const writeCall = scriptOf([[connectorStep("save_comment", "saved"), { kind: "text", text: "done" }]]);

  it("asks the approvals port for a tool that is not read-only", async () => {
    const approvals = createFakeApprovals();
    const harness = connectorHarness({ script: writeCall, approvals });
    await ask(harness, base());
    await waitFor(() => harness.fake.queries[0]?.permissionRequests.length === 1);
    expect(approvals.requests[0]).toMatchObject({
      piSessionId: "thread-1",
      server: "Linear",
      tool: "save_comment",
    });
    expect(harness.fake.queries[0]?.permissionRequests[0]?.decision).toBe("allow");
  });

  it("returns the denial to the CLI", async () => {
    const approvals = createFakeApprovals();
    approvals.answer = "deny";
    const harness = connectorHarness({ script: writeCall, approvals });
    await ask(harness, base());
    await waitFor(() => harness.fake.queries[0]?.permissionRequests.length === 1);
    expect(harness.fake.queries[0]?.permissionRequests[0]?.decision).toBe("deny");
    expect(harness.fake.queries[0]?.connectorCalls[0]?.ran).toBe(false);
  });

  it("allows an always-allowed tool without asking", async () => {
    const approvals = createFakeApprovals();
    approvals.always.add("mcp__claude_ai_Linear__save_comment");
    const harness = connectorHarness({
      script: writeCall,
      approvals,
      connectorStatus: connectedStatuses,
    });
    await ask(harness, base());
    await waitFor(() => harness.fake.queries[0]?.permissionRequests.length === 1);
    expect(approvals.requests).toHaveLength(0);
    expect(harness.fake.queries[0]?.permissionRequests[0]?.decision).toBe("allow");
  });

  it("denies a server that is not chosen without asking", async () => {
    const approvals = createFakeApprovals();
    const harness = connectorHarness({
      script: scriptOf([[connectorStep("slack_send_message", "sent", { server: SLACK })]]),
      approvals,
    });
    await ask(harness, base());
    await waitFor(() => harness.fake.queries[0]?.permissionRequests.length === 1);
    expect(approvals.requests).toHaveLength(0);
    expect(harness.fake.queries[0]?.permissionRequests[0]?.decision).toBe("deny");
  });

  it("counts a pending approval as busy so the idle timer never closes the query", async () => {
    let release: () => void = () => undefined;
    const approvals = createFakeApprovals();
    approvals.request = (request) => {
      approvals.requests.push(request);
      return new Promise((resolve) => {
        release = () => resolve({ allowed: true });
      });
    };
    const harness = connectorHarness({ script: writeCall, approvals });
    await ask(harness, base());
    await waitFor(() => approvals.requests.length === 1);
    harness.clock.advance(16 * 60 * 1000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.fake.queries[0]?.closed).toBe(false);
    release();
  });
});

describe("waiting for connectors", () => {
  it("holds the first input until a connector is listed and none is pending", async () => {
    const harness = connectorHarness({
      pendingPolls: 3,
      connectorStatus: connectedStatuses,
    });
    const asked = ask(harness, base());
    await waitFor(() => harness.fake.queries.length === 1);
    expect(harness.fake.queries[0]?.inputs).toEqual([]);
    await advanceUntil(harness, () => (harness.fake.queries[0]?.inputs.length ?? 0) === 1);
    expect((await asked).message.stopReason).toBe("stop");
    expect(harness.late).toEqual([]);
  });

  it("goes on after 10 s and reports the late servers", async () => {
    const harness = connectorHarness({ pendingPolls: 10_000, connectorStatus: connectedStatuses });
    const asked = ask(harness, base());
    await waitFor(() => harness.fake.queries.length === 1);
    await advanceUntil(harness, () => (harness.fake.queries[0]?.inputs.length ?? 0) === 1);
    await asked;
    expect(harness.late).toEqual([[`${LINEAR}: pending`]]);
  });

  it("does not wait when no connector is chosen", async () => {
    const harness = createHarness();
    await ask(harness, base());
    expect(harness.fake.probes).toHaveLength(0);
  });
});

describe("Stop", () => {
  const slowConnector = scriptOf([[connectorStep("list_teams", "never", { delayMs: 60_000 })]]);

  it("interrupts once for repeated calls and leaves an idle query alone", async () => {
    const harness = connectorHarness({ script: slowConnector });
    await ask(harness, base());
    await Promise.all([
      harness.streamer.interruptConversation("thread-1"),
      harness.streamer.interruptConversation("thread-1"),
    ]);
    expect(harness.fake.queries[0]?.interrupts).toBe(1);
    await harness.streamer.interruptConversation("thread-1");
    expect(harness.fake.queries[0]?.interrupts).toBe(1);
  });

  it("interrupts when the next call carries an aborted connector result", async () => {
    const harness = connectorHarness({ script: slowConnector });
    const messages = base();
    const first = await ask(harness, messages);
    const [call] = toolCallsOf(first.message);
    const aborted = toolResultFor(call as ToolCall, "Tool call was aborted", true);
    await ask(harness, [...messages, first.message, aborted, userMessage("again")]);
    expect(harness.fake.queries[0]?.interrupts).toBe(1);
  });

  it("does nothing for an unknown thread", async () => {
    const harness = connectorHarness();
    await expect(harness.streamer.interruptConversation("nobody")).resolves.toBeUndefined();
  });
});
