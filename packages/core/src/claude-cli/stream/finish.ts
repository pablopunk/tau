import type { Api, AssistantMessage, AssistantMessageEvent, Model } from "@earendil-works/pi-ai";
import { neutralText, textForErrorCode } from "./errors";
import type { TurnOutcome } from "./turn";
import { zeroUsage } from "./usage";

export function emptyAssistantMessage(model: Model<Api>, timestamp: number): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: "stop",
    timestamp,
  };
}

function errorEvent(message: AssistantMessage, text: string): AssistantMessageEvent {
  message.stopReason = "error";
  message.errorMessage = neutralText(text);
  return { type: "error", reason: "error", error: message };
}

/** The last event of a Pi stream: `done`, or `error` with `error` or `aborted`. */
export function finalEvent(
  message: AssistantMessage,
  outcome: TurnOutcome,
  resetsAt: number | null,
): AssistantMessageEvent {
  if (outcome.kind === "aborted") {
    message.stopReason = "aborted";
    return { type: "error", reason: "aborted", error: message };
  }
  if (outcome.kind === "failed") return errorEvent(message, outcome.text);
  const { summary } = outcome;
  if (summary.errorCode !== null) return errorEvent(message, textForErrorCode(summary.errorCode, resetsAt));
  message.stopReason = summary.stopReason;
  return { type: "done", reason: summary.stopReason, message };
}
