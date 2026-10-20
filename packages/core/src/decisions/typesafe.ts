import { AppError } from "@tau/protocol";
import type { DecideClient } from "./client";

export const TYPESAFE_MODEL = "jev-latest";
export const TYPESAFE_BASE_URL = "https://api.typesafe.ai";

/** Request shape for `POST {base}/v1/systemone` with a `noul` keep question. */
export function typesafePredicateBody(
  input: string,
  instructions: string,
): {
  model: string;
  questions: { keep: { type: "noul"; input: string; instructions: string } };
} {
  return { model: TYPESAFE_MODEL, questions: { keep: { type: "noul", input, instructions } } };
}

const NOT_IMPLEMENTED = new AppError(
  "internal",
  "TypeSafe fast compaction is not implemented yet (stub only).",
);

/**
 * Live TypeSafe Jev client (stub). Key resolution: file credential `typesafe` →
 * `TYPESAFE_API_KEY` env. Throws `internal` (not implemented); live behavior is a later phase.
 */
export function createTypesafeClient(_options: {
  readCredential: (id: string) => Promise<string | undefined>;
  env: Readonly<Record<string, string | undefined>>;
  fetchFn?: typeof fetch;
}): DecideClient {
  return {
    id: "typesafe",
    check: async () => {
      throw NOT_IMPLEMENTED;
    },
    predicate: async () => {
      throw NOT_IMPLEMENTED;
    },
  };
}
