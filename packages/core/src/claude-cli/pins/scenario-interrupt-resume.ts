import { createClaudeInput } from "../claude-input";
import { type PinContext, pinOptions } from "./pin-context";
import {
  createPinHost,
  isInit,
  isResult,
  pinTool,
  pollUntil,
  record,
  resultTextOf,
  sleep,
  toolUsesIn,
} from "./pin-harness";

const TURN_TIMEOUT_MS = 90_000;
const RETRY_WINDOW_MS = 8_000;

const WORD_PROMPT = "Call get_word, then reply with the word it returned.";
const RESUME_PROMPT =
  "Your last get_word call was interrupted. Its result is: kiwi. Reply with only the word.";

const tools = () => [pinTool("get_word"), pinTool("get_number")];

export async function runInterruptThenResume(ctx: PinContext): Promise<void> {
  const host = createPinHost(tools());
  const input = createClaudeInput();
  const query = ctx.port.startQuery(pinOptions(ctx.cwd, input.stream, host));
  const recorder = record(query);
  let sessionId: string | null = null;
  try {
    ctx.budget.spend("interrupt: park then interrupt");
    input.push(WORD_PROMPT);
    const init = await recorder.waitFor(isInit, TURN_TIMEOUT_MS, "init");
    sessionId = String(init.session_id);
    ctx.createdSessions.add(sessionId);
    await pollUntil(() => host.calls.length >= 1, TURN_TIMEOUT_MS, "the parked get_word handler");
    await sleep(500);
    const interruptedAt = Date.now();
    await query.interrupt();
    await ctx.report.run("d", "interrupt() with a parked handler gives no retry loop", async () => {
      const result = await recorder.waitFor(isResult, 20_000, "a result after interrupt()");
      const endedAfterMs = Date.now() - interruptedAt;
      await sleep(RETRY_WINDOW_MS);
      const handlerCalls = host.calls.length;
      const toolUses = toolUsesIn(recorder).length;
      if (handlerCalls !== 1 || toolUses !== 1) {
        throw new Error(
          `retry loop: ${handlerCalls} handler calls and ${toolUses} tool_use blocks after interrupt()`,
        );
      }
      return `result in ${endedAfterMs} ms: subtype=${String(result.subtype)} is_error=${String(result.is_error)} terminal_reason=${String(result.terminal_reason)} text="${resultTextOf(result).slice(0, 80)}"; ${RETRY_WINDOW_MS} ms later still 1 handler call, 1 tool_use`;
    });
  } finally {
    input.close();
    query.close();
  }
  if (sessionId) await resumeAfterKilledProcess(ctx, sessionId);
}

async function resumeAfterKilledProcess(ctx: PinContext, sessionId: string): Promise<void> {
  const host = createPinHost(tools());
  ctx.budget.spend("resume after the process was closed");
  const query = ctx.port.startQuery(pinOptions(ctx.cwd, RESUME_PROMPT, host, { resume: sessionId }));
  const recorder = record(query);
  try {
    await ctx.report.run("e", "resume after a killed process", async () => {
      const result = await recorder.waitFor(isResult, TURN_TIMEOUT_MS, "the resumed turn's result");
      const reply = resultTextOf(result);
      if (!/kiwi/i.test(reply)) throw new Error(`reply lacks the word from the user text: ${reply}`);
      const init = recorder.messages.map((entry) => entry.message).find(isInit);
      return `resumed session ${String(init?.session_id === sessionId ? "kept its id" : "got a new id")}; reply "${reply.trim()}"`;
    });
  } finally {
    query.close();
  }
}
