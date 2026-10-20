import { AppError } from "@tau/protocol";
import type { DecideClient } from "./client";

export const OPENAI_DECISIONS_URL = "https://api.openai.com/v1/decisions";
export const OPENAI_DECISIONS_MODEL = "gpt-6-luna";

/** Request shape for `POST https://api.openai.com/v1/decisions` with a predicate. */
export function openaiPredicateBody(
  input: string,
  instructions: string,
): {
  model: string;
  predicate: string;
  input: string;
} {
  return { model: OPENAI_DECISIONS_MODEL, predicate: instructions, input };
}

const NOT_IMPLEMENTED = new AppError(
  "internal",
  "OpenAI fast compaction is not implemented yet (stub only).",
);

/**
 * Live OpenAI Decisions client (stub). Key via `api.models.getAuth("openai")`.
 * Throws `internal` (not implemented); live behavior is a later phase.
 */
export function createOpenaiClient(_options: {
  getAuth: (providerId: string) => Promise<{ auth: { apiKey?: string } } | undefined>;
  fetchFn?: typeof fetch;
}): DecideClient {
  return {
    id: "openai",
    check: async () => {
      throw NOT_IMPLEMENTED;
    },
    predicate: async () => {
      throw NOT_IMPLEMENTED;
    },
  };
}
