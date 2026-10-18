import {
  allToolResults,
  LINEAR_PREFIX,
  loggingPermission,
  startConnectorSession,
  TURN_TIMEOUT_MS,
  waitForConnectors,
} from "./connector-harness";
import { togglerOf } from "./mcp-toggle";
import type { PinContext } from "./pin-context";
import { createPinHost, isResult, pinTool, pollUntil, resolveWith, resultTextOf, sleep } from "./pin-harness";

const LINEAR_GLOB = `${LINEAR_PREFIX}*`;
const LIST_TEAMS = `${LINEAR_PREFIX}list_teams`;
const PARK_MS = 4_000;

const GLOB_PROMPT =
  'Call the Linear list_teams tool once. Then reply on one line exactly as "teams=<count>; slack=<yes or no>", where slack is yes only if you have a tool whose name contains Slack.';
const MIXED_PROMPT =
  'Call get_word and the Linear list_teams tool in parallel in ONE message. Then reply on one line exactly as "word=<word>; teams=<count>".';

const denyAll = async () => ({ behavior: "deny" as const, message: "Not expected to be asked." });

export async function toggleOffPin(ctx: PinContext): Promise<void> {
  const probe = ctx.port.startProbe();
  try {
    await ctx.report.run(
      "o-status",
      "toggleMcpServer(name, false) removes the server's tools from the loaded set",
      async () => {
        const slack = "claude.ai Slack";
        await waitForConnectors(probe);
        await togglerOf(probe).toggleMcpServer(slack, true);
        await waitForConnectors(probe);
        const toolsOf = async () => (await probe.mcpServerStatus()).find((row) => row.name === slack);
        const before = await toolsOf();
        await togglerOf(probe).toggleMcpServer(slack, false);
        const after = await toolsOf();
        if (!before || before.tools.length === 0)
          throw new Error(`Slack had no tools before the toggle: ${before?.status}, ${before?.tools.length}`);
        if (after?.status !== "disabled" || after.tools.length !== 0)
          throw new Error(`Slack after the toggle: ${after?.status}, ${after?.tools.length} tools`);
        return `Slack ${before.status} with ${before.tools.length} tools -> ${after.status} with ${after.tools.length} tools`;
      },
    );
  } finally {
    await togglerOf(probe)
      .toggleMcpServer("claude.ai Slack", true)
      .catch(() => undefined);
    probe.close();
  }
}

export async function globAndToggleTurn(ctx: PinContext): Promise<void> {
  const { canUseTool, log } = loggingPermission(denyAll);
  const session = await startConnectorSession(ctx, { canUseTool, allowedTools: [LINEAR_GLOB] });
  try {
    session.ask(GLOB_PROMPT);
    const result = await session.recorder.waitFor(isResult, TURN_TIMEOUT_MS, "the glob turn's result");
    const reply = resultTextOf(result);
    await ctx.report.run(
      "l",
      "allowedTools with a mcp__claude_ai_Linear__* glob runs a Linear tool with no canUseTool call",
      async () => {
        const ran = allToolResults(session.recorder).filter((row) => !row.isError);
        if (ran.length === 0) throw new Error(`no tool result ok; reply "${reply}"`);
        if (log.requests.length > 0)
          throw new Error(`canUseTool was called for ${log.requests.map((r) => r.toolName)}`);
        return `${ran.length} ok tool result(s), canUseTool not called; reply "${reply.slice(0, 100)}"`;
      },
    );
    await ctx.report.run(
      "o",
      "a server switched off with toggleMcpServer is invisible to the model on the next request",
      async () => {
        if (!/slack\s*=\s*no/i.test(reply)) throw new Error(`the model still saw Slack tools: "${reply}"`);
        return `Slack toggled off before the first input; reply "${reply.slice(0, 100)}"`;
      },
    );
  } finally {
    await session.close();
  }
}

export async function mixedTurn(ctx: PinContext): Promise<void> {
  const host = createPinHost([pinTool("get_word")]);
  const { canUseTool, log } = loggingPermission(denyAll);
  const session = await startConnectorSession(ctx, {
    canUseTool,
    host,
    allowedTools: ["mcp__tau__*", LIST_TEAMS],
  });
  try {
    session.ask(MIXED_PROMPT);
    await ctx.report.run(
      "k",
      "a connector runs while a tau handler is parked, and a late tau result gives a correct turn",
      async () => {
        await pollUntil(() => host.calls.length >= 1, TURN_TIMEOUT_MS, "the parked get_word handler");
        const call = host.calls[0];
        if (!call) throw new Error("no handler call");
        await sleep(PARK_MS);
        const connectorAt =
          allToolResults(session.recorder).find((row) => !row.isError && row.id !== call.toolUseId)?.at ??
          null;
        const releaseAt = Date.now();
        resolveWith(host.deferredFor(call.toolUseId), "banana");
        const result = await session.recorder.waitFor(isResult, TURN_TIMEOUT_MS, "the mixed turn's result");
        const reply = resultTextOf(result);
        if (!/banana/i.test(reply)) throw new Error(`reply lacks the late tau result: "${reply}"`);
        if (log.requests.length > 0)
          throw new Error(`canUseTool was called for ${log.requests.map((r) => r.toolName)}`);
        const whileParked = connectorAt !== null && connectorAt < releaseAt;
        return `connector result ${whileParked ? `arrived ${releaseAt - (connectorAt ?? 0)} ms before the tau release (ran while parked)` : "did not arrive while the handler was parked"}; reply "${reply.slice(0, 100)}"`;
      },
    );
  } finally {
    await session.close();
  }
}
