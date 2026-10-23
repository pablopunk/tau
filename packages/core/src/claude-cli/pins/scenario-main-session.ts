import { createClaudeInput } from "../claude-input";
import type { ClaudeSdkMessage } from "../sdk-types";
import { type PinContext, pinOptions } from "./pin-context";
import {
  assistantTexts,
  createPinHost,
  isInit,
  isResult,
  type PinHost,
  pinTool,
  pollUntil,
  type Recorder,
  record,
  resolveWith,
  resultTextOf,
  sleep,
  toolUsesIn,
} from "./pin-harness";

const TURN_TIMEOUT_MS = 90_000;
const PARK_MS = 2_000;
const IDLE_CHECK_MS = 6_000;

const PARALLEL_PROMPT =
  'Call get_word and get_number in parallel in ONE message. Then reply exactly "<word> <number>".';
const COLOR_PROMPT = "Call get_color and reply with only its result.";
const STEER_PROMPT = "Also add the word kiwi on a second line of your final reply.";

export interface MainSessionOutcome {
  readonly sessionId: string;
  readonly forkAtUuid: string;
}

const ANSWERS: Record<string, string> = {
  mcp__tau__get_word: "banana",
  mcp__tau__get_number: "42",
  mcp__tau__get_color: "teal",
};

function initOf(recorder: Recorder): ClaudeSdkMessage {
  const init = recorder.messages.map((entry) => entry.message).find(isInit);
  if (!init) throw new Error("no init message");
  return init;
}

async function parallelToolRound(_ctx: PinContext, host: PinHost, recorder: Recorder) {
  await pollUntil(() => toolUsesIn(recorder).length >= 2, TURN_TIMEOUT_MS, "two parallel tool_use blocks");
  const [first, second] = toolUsesIn(recorder);
  if (!first || !second) throw new Error("fewer than two tool_use blocks");
  resolveWith(host.deferredFor(second.id), ANSWERS[second.name] ?? "?");
  await sleep(PARK_MS);
  resolveWith(host.deferredFor(first.id), ANSWERS[first.name] ?? "?");
  const result = await recorder.waitFor(isResult, TURN_TIMEOUT_MS, "the result of turn 1");
  return { first, second, reply: resultTextOf(result) };
}

async function pinsAbc(
  ctx: PinContext,
  host: PinHost,
  recorder: Recorder,
  round: Awaited<ReturnType<typeof parallelToolRound>>,
) {
  const init = initOf(recorder);
  const callOf = (id: string) => host.calls.find((call) => call.toolUseId === id);
  const firstCall = callOf(round.first.id);
  const secondCall = callOf(round.second.id);
  await ctx.report.run("a", "init tools only mcp__tau__*, servers only tau, apiKeySource none", async () => {
    const tools = init.tools as string[];
    const servers = (init.mcp_servers as { name: string }[]).map((server) => server.name);
    if (!tools.every((tool) => tool.startsWith("mcp__tau__")) || tools.length !== 2)
      throw new Error(`tools: ${tools}`);
    if (servers.length !== 1 || servers[0] !== "tau") throw new Error(`servers: ${servers}`);
    if (init.apiKeySource !== "none") throw new Error(`apiKeySource: ${String(init.apiKeySource)}`);
    return `tools=${JSON.stringify(tools)} servers=${JSON.stringify(servers)} apiKeySource=none cli=${String(init.claude_code_version)}`;
  });
  await ctx.report.run("b", "parked handler round-trip", async () => {
    if (!firstCall?.returnedAt) throw new Error("first handler never returned");
    const parkedMs = firstCall.returnedAt - firstCall.invokedAt;
    if (parkedMs < PARK_MS - 200) throw new Error(`handler returned after only ${parkedMs} ms`);
    if (!/banana/.test(round.reply) || !/42/.test(round.reply)) throw new Error(`reply: ${round.reply}`);
    return `handler 1 parked ${parkedMs} ms, reply "${round.reply.trim()}"`;
  });
  await ctx.report.run("c", "results in reverse order, before the second handler parks", async () => {
    const resolvedAt = host.deferredFor(round.second.id).settledAt();
    if (!secondCall || resolvedAt === null) throw new Error("second handler or deferred missing");
    const beforeInvoke = secondCall.invokedAt - resolvedAt;
    const heldMs = (secondCall.returnedAt ?? Number.MAX_SAFE_INTEGER) - secondCall.invokedAt;
    if (beforeInvoke < 0)
      throw new Error(`handler 2 was invoked ${-beforeInvoke} ms before its result existed`);
    if (heldMs > 500) throw new Error(`handler 2 parked ${heldMs} ms`);
    return `result 2 resolved ${beforeInvoke} ms before handler 2 was invoked; handler 2 held ${heldMs} ms; handler order=${host.calls.map((c) => c.name).join(",")}`;
  });
}

async function applyEffortAndReadInits(
  ctx: PinContext,
  recorder: Recorder,
  applyEffort: () => Promise<void>,
) {
  const models = await ctx.port.supportedModels();
  const haiku = models.find((model) => model.value === "haiku");
  await applyEffort();
  const effortInits = () =>
    recorder.messages
      .map((entry) => entry.message)
      .filter(isInit)
      .map((init) => init.effort ?? null);
  return { efforts: effortInits, haikuEffortLevels: haiku?.supportedEffortLevels ?? [] };
}

export async function runMainSession(ctx: PinContext): Promise<MainSessionOutcome | null> {
  const host = createPinHost([pinTool("get_word"), pinTool("get_number")]);
  const input = createClaudeInput();
  const query = ctx.port.startQuery(pinOptions(ctx.cwd, input.stream, host));
  const recorder = record(query);
  try {
    ctx.budget.spend("main turn 1: parallel tools");
    input.push(PARALLEL_PROMPT);
    await recorder.waitFor(isInit, TURN_TIMEOUT_MS, "init");
    const init = initOf(recorder);
    const sessionId = String(init.session_id);
    ctx.createdSessions.add(sessionId);
    const round = await parallelToolRound(ctx, host, recorder);
    await pinsAbc(ctx, host, recorder, round);

    await ctx.report.run("f", "autoCompactEnabled: false honoured", async () => {
      const enabled = await query.isAutoCompactEnabled();
      if (enabled) throw new Error("getContextUsage().isAutoCompactEnabled is true");
      return "getContextUsage().isAutoCompactEnabled === false (option sent as settings.autoCompactEnabled=false)";
    });

    const effort = await applyEffortAndReadInits(ctx, recorder, () =>
      query.applyFlagSettings({ effortLevel: "low" }),
    );
    const forkAtUuid = lastAssistantUuidBeforeFirstResult(recorder);

    host.addTool(pinTool("get_color"));
    ctx.budget.spend("main turn 2: new tool");
    input.push(COLOR_PROMPT);
    await ctx.report.run("g", "tools/list_changed mid-session", async () => {
      await pollUntil(
        () => toolUsesIn(recorder).some((use) => use.name === "mcp__tau__get_color"),
        TURN_TIMEOUT_MS,
        "a get_color tool_use",
      );
      await pollUntil(
        () => host.calls.some((call) => call.name === "get_color"),
        TURN_TIMEOUT_MS,
        "the get_color handler",
      );
      return `the model called get_color, added after init (handler invoked ${host.calls.length} times in total)`;
    });

    ctx.budget.spend("main turn 2: steer");
    input.push(STEER_PROMPT);
    await sleep(1_500);
    const colorUse = toolUsesIn(recorder).find((use) => use.name === "mcp__tau__get_color");
    if (colorUse) resolveWith(host.deferredFor(colorUse.id), "teal");
    await pollUntil(() => recorder.count(isResult) >= 2, TURN_TIMEOUT_MS, "the result of turn 2");
    await sleep(IDLE_CHECK_MS);
    await ctx.report.run("i", "a steer pushed with tool results folds into the same turn", async () => {
      const results = recorder.count(isResult);
      const texts = assistantTexts(recorder);
      const last = texts.at(-1) ?? "";
      if (results !== 2)
        throw new Error(
          `${results} result messages after turn 2 plus steer (expected 2): the steer started its own turn`,
        );
      if (!/teal/i.test(last) || !/kiwi/i.test(last))
        throw new Error(`final reply lacks teal and kiwi: ${last}`);
      return `2 result messages in total, final reply "${last.trim().replace(/\n/g, " / ")}"`;
    });

    await ctx.report.run("j", "applyFlagSettings changes effort live", async () => {
      const seen = effort.efforts();
      if (!seen.includes("low")) {
        throw new Error(
          `init.effort values after applyFlagSettings({effortLevel:"low"}): ${JSON.stringify(seen)}; haiku supportedEffortLevels=${JSON.stringify(effort.haikuEffortLevels)}`,
        );
      }
      return `init.effort values: ${JSON.stringify(seen)}`;
    });
    return { sessionId, forkAtUuid };
  } finally {
    input.close();
    query.close();
  }
}

function lastAssistantUuidBeforeFirstResult(recorder: Recorder): string {
  const messages = recorder.messages.map((entry) => entry.message);
  const resultIndex = messages.findIndex(isResult);
  const candidates = messages.slice(0, resultIndex).filter((message) => message.type === "assistant");
  const uuid = candidates.at(-1)?.uuid;
  if (!uuid) throw new Error("no assistant uuid before the first result");
  return uuid;
}
