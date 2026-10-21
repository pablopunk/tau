import { AppError } from "@tau/protocol";
import type { Availability, DecideClient } from "./client";

export const OPENAI_DECISIONS_URL = "https://api.openai.com/v1/decisions";
/** Env override for the full decisions endpoint; tests point it at a localhost mock. */
export const OPENAI_DECISIONS_URL_ENV = "TAU_OPENAI_DECISIONS_URL";
export const OPENAI_DECISIONS_MODEL = "gpt-6-luna";

/** Own timeout per request; the hook additionally races every call. */
export const OPENAI_REQUEST_TIMEOUT_MS = 30_000;

/** Request shape for `POST /v1/decisions`: content in `input`, questions as an
 * array (verified live against the API). */
export function openaiPredicateBody(
  input: string,
  instructions: string,
): {
  model: string;
  input: string;
  questions: { type: "predicate"; name: string; instructions: string }[];
} {
  return {
    model: OPENAI_DECISIONS_MODEL,
    input,
    questions: [{ type: "predicate", name: "keep", instructions }],
  };
}

export interface OpenaiClientOptions {
  readonly getAuth: (providerId: string) => Promise<{ auth: { apiKey?: string } } | undefined>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchFn?: typeof fetch;
  readonly baseUrl?: string;
}

async function resolveKey(options: OpenaiClientOptions): Promise<string | undefined> {
  return (await options.getAuth("openai").catch(() => undefined))?.auth.apiKey;
}

function requestError(status: number, detail: string): AppError {
  if (status === 401) return new AppError("invalid_key", `OpenAI rejected this API key (${status}).`);
  return new AppError("internal", `OpenAI decisions request failed (${status}): ${detail}`);
}

function parseProbability(json: unknown): number {
  const answers =
    typeof json === "object" && json !== null ? (json as { answers?: unknown }).answers : undefined;
  const first = Array.isArray(answers) ? answers[0] : undefined;
  const value =
    typeof first === "object" && first !== null
      ? (first as { probability?: unknown }).probability
      : undefined;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new AppError("internal", "OpenAI decisions response had no keep probability.");
  }
  return Math.min(1, Math.max(0, value));
}

function probeUnavailable(status: number, body: string): boolean {
  return status === 403 || status === 404 || body.includes("model_not_found");
}

/** Live OpenAI Decisions client. Key via `api.models.getAuth("openai")`. */
export function createOpenaiClient(options: OpenaiClientOptions): DecideClient {
  const fetchFn = options.fetchFn ?? fetch;
  const url = options.baseUrl ?? options.env?.[OPENAI_DECISIONS_URL_ENV] ?? OPENAI_DECISIONS_URL;
  return {
    id: "openai",
    check: async (): Promise<Availability> => {
      const key = await resolveKey(options);
      if (key === undefined) return "unavailable";
      let response: Response;
      try {
        response = await fetchFn(url, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(openaiPredicateBody("hello", "Answer yes.")),
          signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
        });
      } catch {
        return "unknown";
      }
      if (response.ok) return "ready";
      if (probeUnavailable(response.status, await response.text().catch(() => ""))) {
        return "unavailable";
      }
      return "unknown";
    },
    predicate: async (input: string, instructions: string): Promise<number> => {
      const key = await resolveKey(options);
      if (key === undefined) {
        throw new AppError("no_provider", "Connect OpenAI to use fast compaction.");
      }
      let response: Response;
      try {
        response = await fetchFn(url, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(openaiPredicateBody(input, instructions)),
          signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw new AppError(
          "internal",
          `OpenAI decisions request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!response.ok) throw requestError(response.status, await response.text().catch(() => ""));
      return parseProbability(await response.json().catch(() => undefined));
    },
  };
}
