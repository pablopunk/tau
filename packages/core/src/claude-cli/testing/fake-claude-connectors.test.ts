import { describe, expect, it } from "vitest";
import type {
  ClaudeCanUseTool,
  ClaudePermissionDecision,
  ClaudeQuery,
  ClaudeQueryOptions,
  ClaudeSdkMessage,
} from "../sdk-types";
import { FAKE_LINEAR, FAKE_NEEDS_AUTH, FAKE_SLACK } from "./fake-claude-connectors";
import { scriptOf } from "./fake-claude-script";
import { createFakeClaudeSdk } from "./fake-claude-sdk";

const LIST_TEAMS = "mcp__claude_ai_Linear__list_teams";
const SAVE_COMMENT = "mcp__claude_ai_Linear__save_comment";

const connectorOptions = (overrides: Partial<ClaudeQueryOptions> = {}): ClaudeQueryOptions => ({
  prompt: "list my teams",
  model: "haiku",
  cwd: "/tmp",
  systemPrompt: "test",
  env: {},
  title: "tau · test",
  tools: [],
  strictMcpConfig: false,
  settingSources: [],
  settings: { disableClaudeAiConnectors: false, autoCompactEnabled: false },
  permissionMode: "default",
  allowedTools: [],
  includePartialMessages: true,
  ...overrides,
});

const linearCall = (tool: string, result: string, extra: { delayMs?: number } = {}) => ({
  name: tool,
  arguments: {},
  connector: { server: "claude.ai Linear", result, ...extra },
});

async function untilResult(query: ClaudeQuery): Promise<ClaudeSdkMessage[]> {
  const seen: ClaudeSdkMessage[] = [];
  for await (const message of query) {
    seen.push(message);
    if (message.type === "result") break;
  }
  return seen;
}

const toolResultsIn = (messages: readonly ClaudeSdkMessage[]) =>
  messages.flatMap((message) => {
    const content = (message.message as { content?: unknown } | undefined)?.content;
    return message.type === "user" && Array.isArray(content) ? content : [];
  });

const allowAll: ClaudeCanUseTool = async (request): Promise<ClaudePermissionDecision> => ({
  behavior: "allow",
  updatedInput: request.input,
});

const denyAll: ClaudeCanUseTool = async () => ({
  behavior: "deny",
  message: "The user denied this tool call.",
});

function fakeWith(steps: Parameters<typeof scriptOf>[0], extra: { pendingPolls?: number } = {}) {
  return createFakeClaudeSdk({
    script: scriptOf(steps),
    connectors: [FAKE_LINEAR, FAKE_SLACK, FAKE_NEEDS_AUTH],
    ...extra,
  });
}

describe("fake SDK connectors", () => {
  it("lists only tau when locked down and the connectors when open", async () => {
    const fake = fakeWith([[{ kind: "text", text: "ok" }]]);
    const locked = fake.port.startQuery(
      connectorOptions({ strictMcpConfig: true, settings: { disableClaudeAiConnectors: true } }),
    );
    expect((await locked.mcpServerStatus()).map((server) => server.name)).toEqual(["tau"]);
    const open = fake.port.startQuery(connectorOptions());
    const names = (await open.mcpServerStatus()).map((server) => `${server.name}:${server.status}`);
    expect(names).toEqual([
      "tau:connected",
      "claude.ai Linear:connected",
      "claude.ai Slack:connected",
      "claude.ai Notion:needs-auth",
    ]);
    locked.close();
    open.close();
  });

  it("reports pending connectors for the first polls, then settles", async () => {
    const fake = fakeWith([[{ kind: "text", text: "ok" }]], { pendingPolls: 2 });
    const query = fake.port.startQuery(connectorOptions());
    const statusOf = async () =>
      (await query.mcpServerStatus()).find((server) => server.name === "claude.ai Linear")?.status;
    expect([await statusOf(), await statusOf(), await statusOf()]).toEqual([
      "pending",
      "pending",
      "connected",
    ]);
    query.close();
  });

  it("a toggled-off server is disabled with no tools, and is recorded", async () => {
    const fake = fakeWith([[{ kind: "text", text: "ok" }]]);
    const query = fake.port.startQuery(connectorOptions());
    await query.toggleMcpServer("claude.ai Slack", false);
    const slack = (await query.mcpServerStatus()).find((server) => server.name === "claude.ai Slack");
    expect(slack).toMatchObject({ status: "disabled", tools: [] });
    expect(fake.queries[0]?.toggles).toEqual([{ name: "claude.ai Slack", enabled: false }]);
    query.close();
  });

  it("a probe lists connectors without any query record", async () => {
    const fake = fakeWith([[{ kind: "text", text: "ok" }]]);
    const probe = fake.port.startProbe({ settingSources: ["user"] });
    const servers = await probe.mcpServerStatus();
    expect(servers.map((server) => server.name)).toContain("claude.ai Linear");
    expect(fake.queries).toHaveLength(0);
    expect(fake.probes).toEqual([{ settingSources: ["user"] }]);
    probe.close();
  });

  it("the CLI runs an allowed connector call, then starts the next message by itself", async () => {
    const fake = fakeWith([
      [
        { kind: "tools", calls: [linearCall("list_teams", "Team A")] },
        { kind: "text", text: "You have Team A." },
      ],
    ]);
    const query = fake.port.startQuery(connectorOptions({ allowedTools: ["mcp__claude_ai_Linear__*"] }));
    const messages = await untilResult(query);
    expect(toolResultsIn(messages)).toMatchObject([
      { tool_use_id: expect.any(String), content: "Team A", is_error: false },
    ]);
    expect(fake.queries[0]?.permissionRequests).toEqual([]);
    expect(fake.queries[0]?.connectorCalls).toMatchObject([{ toolName: LIST_TEAMS, ran: true }]);
    expect(fake.queries[0]?.inputs).toEqual(["list my teams"]);
    query.close();
  });

  it("a late result arrives after the delay", async () => {
    const fake = fakeWith([
      [
        { kind: "tools", calls: [linearCall("list_teams", "Late", { delayMs: 30 })] },
        { kind: "text", text: "done" },
      ],
    ]);
    const query = fake.port.startQuery(connectorOptions({ allowedTools: [LIST_TEAMS] }));
    const startedAt = Date.now();
    await untilResult(query);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(25);
    query.close();
  });

  it("asks canUseTool for a tool outside allowedTools: allow runs it, deny blocks it", async () => {
    const steps = [
      [
        { kind: "tools" as const, calls: [linearCall("save_comment", "saved")] },
        { kind: "text" as const, text: "ok" },
      ],
    ];
    const allowed = fakeWith(steps);
    const allowQuery = allowed.port.startQuery(connectorOptions({ canUseTool: allowAll }));
    expect(toolResultsIn(await untilResult(allowQuery))).toMatchObject([
      { content: "saved", is_error: false },
    ]);
    expect(allowed.queries[0]?.permissionRequests).toMatchObject([
      { toolName: SAVE_COMMENT, decision: "allow" },
    ]);

    const denied = fakeWith(steps);
    const denyQuery = denied.port.startQuery(connectorOptions({ canUseTool: denyAll }));
    expect(toolResultsIn(await untilResult(denyQuery))).toMatchObject([
      { content: "The user denied this tool call.", is_error: true },
    ]);
    expect(denied.queries[0]?.connectorCalls).toMatchObject([{ toolName: SAVE_COMMENT, ran: false }]);
    allowQuery.close();
    denyQuery.close();
  });

  it("denies at once under dontAsk when the tool is not allowed", async () => {
    const fake = fakeWith([
      [
        { kind: "tools", calls: [linearCall("save_comment", "saved")] },
        { kind: "text", text: "ok" },
      ],
    ]);
    const query = fake.port.startQuery(connectorOptions({ permissionMode: "dontAsk", canUseTool: allowAll }));
    expect(toolResultsIn(await untilResult(query))).toMatchObject([{ is_error: true }]);
    expect(fake.queries[0]?.permissionRequests).toEqual([]);
    query.close();
  });

  it("a tool of a toggled-off server is not available", async () => {
    const fake = fakeWith([
      [
        { kind: "tools", calls: [linearCall("list_teams", "x")] },
        { kind: "text", text: "ok" },
      ],
    ]);
    const query = fake.port.startQuery(connectorOptions({ allowedTools: [LIST_TEAMS] }));
    await query.toggleMcpServer("claude.ai Linear", false);
    expect(toolResultsIn(await untilResult(query))).toMatchObject([{ is_error: true }]);
    query.close();
  });

  it("interrupt() while canUseTool waits aborts the signal and ends the turn", async () => {
    let signal: AbortSignal | undefined;
    const waiting: ClaudeCanUseTool = (request) =>
      new Promise<ClaudePermissionDecision>(() => {
        signal = request.signal;
      });
    const fake = fakeWith([
      [
        { kind: "tools", calls: [linearCall("save_comment", "saved")] },
        { kind: "text", text: "ok" },
      ],
    ]);
    const query = fake.port.startQuery(connectorOptions({ canUseTool: waiting }));
    const done = untilResult(query);
    for (let attempt = 0; attempt < 100 && !signal; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    await query.interrupt();
    const messages = await done;
    expect(signal?.aborted).toBe(true);
    expect(messages.at(-1)).toMatchObject({ type: "result", subtype: "error_during_execution" });
    query.close();
  });
});
