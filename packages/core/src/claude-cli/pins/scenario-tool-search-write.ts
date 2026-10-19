import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApprovalRequest, Approvals, ApprovalVerdict } from "../../approvals/approvals-port";
import { createClaudeInput } from "../claude-input";
import { chooseServers } from "../connectors/chosen-servers";
import type { ClaudeMcpServerStatus } from "../sdk-types";
import type { Binding } from "../stream/binding";
import { createCanUseTool } from "../stream/permissions";
import { buildQueryOptions } from "../stream/query-options";
import type { Runtime } from "../stream/runtime";
import { allToolResults, loggingPermission, TURN_TIMEOUT_MS, waitForConnectors } from "./connector-harness";
import { PIN_MODEL, type PinContext } from "./pin-context";
import { createPinHost, isResult, record, toolUsesOf } from "./pin-harness";

const SERVER_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "tool-search-fixture-server.mjs",
);
/** Named like a claude.ai connector, so tau's own `canUseTool` and names apply. */
export const CONNECTOR_STYLE_SERVER = "claude.ai Fixture";
/** Named like a user-defined server. */
export const USER_STYLE_SERVER = "tau_fixture_user";
const WRITE_TEXT = "tau-pin-write";

const prefixOf = (server: string) => `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, "_")}__`;

const statusOf = (server: string): ClaudeMcpServerStatus => ({
  name: server,
  status: "connected",
  source: "claudeai",
  error: null,
  tools: [
    { name: "fixture_read", readOnly: true },
    { name: "fixture_write", readOnly: false },
  ],
});

interface Approver {
  readonly approvals: Approvals;
  readonly asked: string[];
}

function approverOf(allow: boolean): Approver {
  const asked: string[] = [];
  const verdict: ApprovalVerdict = allow
    ? { allowed: true }
    : { allowed: false, message: "The user denied this tool call." };
  return {
    asked,
    approvals: {
      async request(request: ApprovalRequest) {
        asked.push(`${request.server}/${request.tool}`);
        return verdict;
      },
      isAlwaysAllowed: async () => false,
    } as unknown as Approvals,
  };
}

interface Run {
  readonly requests: string[];
  readonly toolUses: string[];
  readonly results: { id: string; isError: boolean; text: string }[];
  readonly file: string;
  readonly approverAsked: string[];
  readonly fileText: () => string;
  readonly readOnlyFlags: string;
}

async function runTurn(
  ctx: PinContext,
  setup: { server: string; askBeforeWrites: boolean; allow: boolean; prompt: string },
): Promise<Run> {
  const dir = await mkdtemp(join(tmpdir(), "tau-tool-search-"));
  const file = join(dir, "fixture.txt");
  const settings = { disabled: [], alwaysAllow: [], askBeforeWrites: setup.askBeforeWrites };
  const chosen = chooseServers(settings, [statusOf(setup.server)]);
  const approver = approverOf(setup.allow);
  const production = createCanUseTool(
    { deps: { approvals: approver.approvals } } as unknown as Runtime,
    { pendingApprovals: 0 } as unknown as Binding,
    chosen.names,
    setup.askBeforeWrites,
  );
  const logging = loggingPermission(async (request) => production(request));
  const input = createClaudeInput();
  const options = buildQueryOptions({
    prompt: input.stream,
    model: PIN_MODEL,
    cwd: ctx.cwd,
    systemPrompt: "You are a test agent. Use the tools when asked. Be terse.",
    env: process.env,
    title: "tau-pin (safe to delete)",
    toolHost: createPinHost([]),
    connectors: { allowedTools: chosen.allowedTools, disallowedTools: [], canUseTool: logging.canUseTool },
  });
  const query = ctx.port.startQuery({
    ...options,
    mcpServers: { [setup.server]: { command: "node", args: [SERVER_SCRIPT], env: { FIXTURE_FILE: file } } },
  });
  const recorder = record(query);
  try {
    const { servers } = await waitForConnectors(query);
    const fixture = servers.find((server) => server.name === setup.server);
    if (fixture?.status !== "connected")
      throw new Error(`fixture server not connected: ${JSON.stringify(fixture)}`);
    ctx.budget.spend(setup.prompt.slice(0, 60));
    input.push(setup.prompt);
    await recorder.waitFor(isResult, TURN_TIMEOUT_MS, "the turn's result");
    return {
      requests: logging.log.requests.map((request) => request.toolName),
      toolUses: recorder.messages.flatMap(({ message }) => toolUsesOf(message).map((use) => use.name)),
      results: allToolResults(recorder),
      file,
      approverAsked: approver.asked,
      fileText: () => (existsSync(file) ? readFileSync(file, "utf8") : ""),
      readOnlyFlags: fixture.tools.map((tool) => `${tool.name}:${tool.readOnly}`).join(","),
    };
  } finally {
    input.close();
    query.close();
  }
}

const readPrompt = "Call the fixture_read tool once (find it with tool search), then say what it returned.";
const writePrompt = `Call the fixture_write tool once with text "${WRITE_TEXT}" (find it with tool search), then say what happened.`;

function requireDeferredFirst(run: Run): void {
  const search = run.toolUses.indexOf("ToolSearch");
  const target = run.toolUses.findIndex(
    (name) => name.endsWith("fixture_read") || name.endsWith("fixture_write"),
  );
  if (search < 0 || target < 0 || search > target)
    throw new Error(`the tool was not found through ToolSearch first: ${run.toolUses}`);
}

export async function toolSearchWritePins(ctx: PinContext): Promise<void> {
  const server = CONNECTOR_STYLE_SERVER;
  const prefix = prefixOf(server);
  await ctx.report.run(
    "w1",
    "a read-only tool found by ToolSearch runs without a prompt (askBeforeWrites on)",
    async () => {
      const run = await runTurn(ctx, { server, askBeforeWrites: true, allow: false, prompt: readPrompt });
      requireDeferredFirst(run);
      if (!run.toolUses.includes(`${prefix}fixture_read`)) throw new Error(`no read call: ${run.toolUses}`);
      if (run.requests.length > 0 || run.approverAsked.length > 0)
        throw new Error(`the read prompted: canUseTool ${run.requests}, approvals ${run.approverAsked}`);
      if (!run.results.some((row) => !row.isError && row.text.includes("READ_OK")))
        throw new Error(`no READ_OK result: ${JSON.stringify(run.results.slice(-3))}`);
      return `status flags ${run.readOnlyFlags}; tool uses ${run.toolUses}; no canUseTool request; READ_OK`;
    },
  );
  await ctx.report.run(
    "w2",
    "a write found by ToolSearch asks first; deny leaves the file untouched",
    async () => {
      const run = await runTurn(ctx, { server, askBeforeWrites: true, allow: false, prompt: writePrompt });
      requireDeferredFirst(run);
      if (!run.requests.includes(`${prefix}fixture_write`))
        throw new Error(`no canUseTool for the write: ${run.requests}`);
      if (run.approverAsked.length !== 1) throw new Error(`approvals asked ${run.approverAsked}`);
      if (run.fileText() !== "") throw new Error(`the denied write ran: ${JSON.stringify(run.fileText())}`);
      return `canUseTool ${run.requests}; approvals ${run.approverAsked}; denied; file empty`;
    },
  );
  await ctx.report.run("w3", "a write found by ToolSearch runs after allow", async () => {
    const run = await runTurn(ctx, { server, askBeforeWrites: true, allow: true, prompt: writePrompt });
    requireDeferredFirst(run);
    if (!run.requests.includes(`${prefix}fixture_write`))
      throw new Error(`no canUseTool for the write: ${run.requests}`);
    if (run.fileText() !== `${WRITE_TEXT}\n`)
      throw new Error(`file after allow: ${JSON.stringify(run.fileText())}`);
    return `canUseTool ${run.requests}; allowed; file ${JSON.stringify(run.fileText())}`;
  });
  await ctx.report.run("w4", "askBeforeWrites off: the write runs with no prompt", async () => {
    const run = await runTurn(ctx, { server, askBeforeWrites: false, allow: false, prompt: writePrompt });
    if (run.requests.length > 0 || run.approverAsked.length > 0) throw new Error(`prompted: ${run.requests}`);
    if (run.fileText() !== `${WRITE_TEXT}\n`) throw new Error(`file: ${JSON.stringify(run.fileText())}`);
    return `no canUseTool request; file ${JSON.stringify(run.fileText())}`;
  });
  await ctx.report.run(
    "w5",
    "a user-defined server name is found by ToolSearch and the CLI reports its read-only flags",
    async () => {
      const run = await runTurn(ctx, {
        server: USER_STYLE_SERVER,
        askBeforeWrites: true,
        allow: true,
        prompt: readPrompt,
      });
      requireDeferredFirst(run);
      return `tool uses ${run.toolUses}; canUseTool ${run.requests}; results ${JSON.stringify(run.results.slice(-1))}; flags ${run.readOnlyFlags}`;
    },
  );
}
