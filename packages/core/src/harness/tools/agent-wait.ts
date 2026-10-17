import type { ConversationId, ToolExecutionApi } from "@earendil-works/pi-durable";
import { setAgentStatus } from "../subagent-status";
import { finalAnswerOf } from "./task-answer";

type CallContext = Parameters<ToolExecutionApi["commit"]>[1];

export const NO_REPORT = "The subagent finished without a report.";

/** `run_in_background: false`: send the prompt, wait for the answer and return it. No notification is posted. */
export async function runAndWait(
  api: ToolExecutionApi,
  context: CallContext,
  childId: ConversationId,
  prompt: string,
) {
  const child = await api.conversation(childId, context);
  const request = { type: "input", content: prompt, requestId: `agent:${api.callId}` } as const;
  const settled = await (await child?.submit(request, context))?.wait(context);
  const status = settled?.status === "done" ? "done" : "failed";
  const report = await api.commit(async (tx) => {
    await setAgentStatus(tx, childId, status);
    return finalAnswerOf(tx, childId);
  }, context);
  return { status, report: report || NO_REPORT };
}
