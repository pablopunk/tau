import {
  type ConversationSummary,
  type ConversationView,
  readRuntimeLive,
  waitOutcomeOf,
} from "@tau/protocol";
import {
  nativeAnswerOf,
  nativeBlockedMessageOf,
  nativeErrorMessageOf,
  nativeUnknownOutcomeMessage,
} from "./native-text";

export type NativeAssessment =
  | { readonly state: "waiting" }
  | { readonly state: "done"; readonly answer: string }
  | { readonly state: "error"; readonly message: string };

export interface NativeWaitContext {
  readonly endedAfterR0: boolean;
  readonly childRunning: boolean;
}

const waiting: NativeAssessment = { state: "waiting" };
const errorOf = (message: string): NativeAssessment => ({ state: "error", message });

const NO_RUN_MESSAGE = "the thread has no recorded native run, so its outcome is unknown";

/** Unknown is never success: no lifecycle, an unverifiable writer or an unknown outcome all fail. */
export function assessNativeThread(
  summary: ConversationSummary,
  view: ConversationView,
  context: NativeWaitContext,
): NativeAssessment {
  const info = readRuntimeLive(view, "claude-code");
  if (info.lifecycle === "blocked") return errorOf(nativeBlockedMessageOf(view));
  if (info.lifecycle === undefined)
    return summary.status === "running" || !context.endedAfterR0 ? waiting : errorOf(NO_RUN_MESSAGE);
  if (waitOutcomeOf(info) === "unknown") return errorOf(nativeUnknownOutcomeMessage());
  if (!context.endedAfterR0) return waiting;
  if (summary.status === "error" || info.lifecycle === "failed") return errorOf(nativeErrorMessageOf(view));
  if (info.lifecycle === "cancelled" || info.lifecycle === "interrupted")
    return errorOf(`the run was ${info.lifecycle}`);
  const settled =
    waitOutcomeOf(info) === "done" &&
    summary.status === "idle" &&
    info.queued.length === 0 &&
    !context.childRunning;
  return settled ? { state: "done", answer: nativeAnswerOf(view) } : waiting;
}
