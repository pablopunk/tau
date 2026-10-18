import type { ClaudePermissionDecision } from "../sdk-types";
import {
  allToolResults,
  LINEAR_PREFIX,
  loggingPermission,
  startConnectorSession,
  TURN_TIMEOUT_MS,
  transcriptSummary,
} from "./connector-harness";
import type { PinContext } from "./pin-context";
import { isResult, resultTextOf, sleep } from "./pin-harness";

const DENY_MESSAGE = "The user denied this tool call.";
const LONG_WAIT_MS = Number(process.env.TAU_PIN_APPROVAL_WAIT_MS ?? 5 * 60 * 1000);
const LONG_TURN_TIMEOUT_MS = LONG_WAIT_MS + TURN_TIMEOUT_MS;

const WRITE_PROMPT =
  'Call the Linear tool save_comment with issueId "ZZZ-0" and body "tau pin test". Then say in one line what happened.';
const READ_PROMPT = "Call the Linear list_teams tool once, then reply with the number of teams.";

const denyAfterLongWait = async (): Promise<ClaudePermissionDecision> => {
  await sleep(LONG_WAIT_MS);
  return { behavior: "deny", message: DENY_MESSAGE };
};

export async function denyWritePin(ctx: PinContext): Promise<void> {
  const { canUseTool, log } = loggingPermission(denyAfterLongWait);
  const session = await startConnectorSession(ctx, { canUseTool, allowedTools: [] });
  try {
    await ctx.report.run(
      "n-deny",
      `canUseTool is asked for a write tool, a ${LONG_WAIT_MS} ms wait does not time out, deny blocks it`,
      async () => {
        session.ask(WRITE_PROMPT);
        const result = await session.recorder.waitFor(
          isResult,
          LONG_TURN_TIMEOUT_MS,
          "the write turn's result",
        );
        const request = log.requests.find((row) => row.toolName === `${LINEAR_PREFIX}save_comment`);
        if (!request)
          throw new Error(
            `canUseTool never saw save_comment; saw ${log.requests.map((r) => r.toolName)}; ${transcriptSummary(session.recorder)}`,
          );
        const blocked = allToolResults(session.recorder).find((row) => row.id === request.toolUseId);
        if (!blocked?.isError || !blocked.text.includes(DENY_MESSAGE))
          throw new Error(`the deny did not reach the tool result: ${JSON.stringify(blocked)}`);
        if (log.aborted()) throw new Error("the permission signal aborted during the wait");
        return `asked for ${request.toolName} (mcpServer=${JSON.stringify(request.mcpServer)}), waited ${LONG_WAIT_MS} ms, signal not aborted; tool_result is_error with the deny text; reply "${resultTextOf(result).slice(0, 100)}"`;
      },
    );
  } finally {
    await session.close();
  }
}

export async function allowReadPin(ctx: PinContext): Promise<void> {
  const { canUseTool, log } = loggingPermission(async (request) => ({
    behavior: "allow",
    updatedInput: request.input,
  }));
  const session = await startConnectorSession(ctx, { canUseTool, allowedTools: [] });
  try {
    await ctx.report.run("n-allow", "canUseTool allow lets a read-only connector tool run", async () => {
      session.ask(READ_PROMPT);
      const result = await session.recorder.waitFor(isResult, TURN_TIMEOUT_MS, "the read turn's result");
      const request = log.requests.find((row) => row.toolName === `${LINEAR_PREFIX}list_teams`);
      const ran = allToolResults(session.recorder).find((row) => row.id === request?.toolUseId);
      if (!request)
        throw new Error(
          `canUseTool was not called for list_teams (saw ${log.requests.map((r) => r.toolName)}); ${transcriptSummary(session.recorder)}`,
        );
      if (!ran || ran.isError) throw new Error(`list_teams did not run: ${JSON.stringify(ran)}`);
      return `canUseTool asked for list_teams (not in allowedTools); allowed; tool_result ok; reply "${resultTextOf(result).slice(0, 100)}"`;
    });
  } finally {
    await session.close();
  }
}
