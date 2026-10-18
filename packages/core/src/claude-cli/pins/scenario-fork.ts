import { type PinContext, pinOptions } from "./pin-context";
import { createPinHost, isInit, isResult, pinTool, record, resultTextOf } from "./pin-harness";
import type { MainSessionOutcome } from "./scenario-main-session";

const TURN_TIMEOUT_MS = 90_000;
const FORK_PROMPT =
  "Reply with exactly two words: the secret word you got earlier, then yes or no for whether you ever called get_color.";

export async function runResumeAtFork(ctx: PinContext, main: MainSessionOutcome): Promise<void> {
  const host = createPinHost([pinTool("get_word"), pinTool("get_number")]);
  ctx.budget.spend("fork at the end of turn 1");
  const query = ctx.port.startQuery(
    pinOptions(ctx.cwd, FORK_PROMPT, host, {
      resume: main.sessionId,
      resumeSessionAt: main.forkAtUuid,
      forkSession: true,
    }),
  );
  const recorder = record(query);
  try {
    await ctx.report.run("h", "resumeSessionAt + forkSession", async () => {
      const result = await recorder.waitFor(isResult, TURN_TIMEOUT_MS, "the fork's result");
      const init = recorder.messages.map((entry) => entry.message).find(isInit);
      const forkId = String(init?.session_id);
      ctx.createdSessions.add(forkId);
      const reply = resultTextOf(result).trim();
      if (forkId === main.sessionId) throw new Error("the fork kept the original session id");
      if (!/banana/i.test(reply))
        throw new Error(`the fork lost the history before the fork point: "${reply}"`);
      if (!/\bno\b/i.test(reply)) throw new Error(`the fork still saw the later get_color turn: "${reply}"`);
      return `new session id ${forkId} (original ${main.sessionId}); reply "${reply}"`;
    });
  } finally {
    query.close();
  }
}
