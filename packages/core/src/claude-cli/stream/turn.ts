import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { ClaudeSdkMessage } from "../sdk-types";
import { createApiMessageReader, type ReaderSummary } from "./api-message-reader";
import { GENERIC_RESULT_TEXT, PROCESS_ENDED_TEXT } from "./errors";

export type FailureKind = "limit" | "other";

export type TurnOutcome =
  | { readonly kind: "complete"; readonly summary: ReaderSummary }
  | { readonly kind: "failed"; readonly text: string; readonly failure: FailureKind }
  | { readonly kind: "aborted" };

/** One Pi stream: it reads exactly one API message from the SDK query. */
export interface Turn {
  readonly message: AssistantMessage;
  readonly outcome: Promise<TurnOutcome>;
  feed(message: ClaudeSdkMessage): void;
  /** A `result` message arrived while the API message was not complete. */
  onResult(message: ClaudeSdkMessage): void;
  fail(text: string, failure?: FailureKind): void;
  /** The query process ended. */
  end(): void;
  abort(): void;
  isSettled(): boolean;
}

export function createTurn(message: AssistantMessage, push: (event: AssistantMessageEvent) => void): Turn {
  let settled = false;
  let resolveOutcome: (outcome: TurnOutcome) => void = () => undefined;
  const outcome = new Promise<TurnOutcome>((resolve) => {
    resolveOutcome = resolve;
  });
  const settle = (result: TurnOutcome) => {
    if (settled) return;
    settled = true;
    resolveOutcome(result);
  };
  const reader = createApiMessageReader(message, push, (summary) => settle({ kind: "complete", summary }));
  return {
    message,
    outcome,
    feed(sdk) {
      if (!settled) reader.feed(sdk);
    },
    onResult: () => settle({ kind: "failed", text: GENERIC_RESULT_TEXT, failure: "other" }),
    fail: (text, failure = "other") => settle({ kind: "failed", text, failure }),
    end: () => settle({ kind: "failed", text: PROCESS_ENDED_TEXT, failure: "other" }),
    abort() {
      if (settled) return;
      reader.dropOpenToolCalls();
      settle({ kind: "aborted" });
    },
    isSettled: () => settled,
  };
}
