import { AppError } from "@tau/protocol";
import type { Availability, DecideClient } from "./client";

export const TYPESAFE_MODEL = "jev-latest";
export const TYPESAFE_BASE_URL = "https://api.typesafe.ai";
/** Env override for the API base; tests point it at a localhost mock. */
export const TYPESAFE_BASE_URL_ENV = "TAU_TYPESAFE_BASE_URL";

/** Own timeout per request; the hook additionally races every call. */
export const TYPESAFE_REQUEST_TIMEOUT_MS = 30_000;

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

export interface TypesafeClientOptions {
  readonly readCredential: (id: string) => Promise<string | undefined>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchFn?: typeof fetch;
  readonly baseUrl?: string;
}

async function resolveKey(options: TypesafeClientOptions): Promise<string | undefined> {
  return (await options.readCredential("typesafe")) ?? options.env.TYPESAFE_API_KEY ?? undefined;
}

function requestError(status: number, detail: string): AppError {
  if (status === 401) return new AppError("invalid_key", `TypeSafe rejected this API key (${status}).`);
  return new AppError("internal", `TypeSafe decisions request failed (${status}): ${detail}`);
}

function parseNoul(json: unknown): number {
  const value =
    typeof json === "object" && json !== null
      ? (json as { answers?: { keep?: { noul?: unknown } } }).answers?.keep?.noul
      : undefined;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new AppError("internal", "TypeSafe decisions response had no keep probability.");
  }
  return Math.min(1, Math.max(0, value));
}

/** Live TypeSafe Jev client. Key resolution: file credential `typesafe` → `TYPESAFE_API_KEY` env. */
export function createTypesafeClient(options: TypesafeClientOptions): DecideClient {
  const baseUrl = options.baseUrl ?? options.env[TYPESAFE_BASE_URL_ENV] ?? TYPESAFE_BASE_URL;
  const fetchFn = options.fetchFn ?? fetch;
  return {
    id: "typesafe",
    check: async (): Promise<Availability> => {
      const key = await resolveKey(options);
      if (key === undefined) return "unavailable";
      let response: Response;
      try {
        response = await fetchFn(`${baseUrl}/v1/models`, {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(TYPESAFE_REQUEST_TIMEOUT_MS),
        });
      } catch {
        return "unknown";
      }
      if (response.ok) return "ready";
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        return "unavailable";
      }
      return "unknown";
    },
    predicate: async (input: string, instructions: string): Promise<number> => {
      const key = await resolveKey(options);
      if (key === undefined) {
        throw new AppError("no_provider", "Connect TypeSafe to use fast compaction.");
      }
      let response: Response;
      try {
        response = await fetchFn(`${baseUrl}/v1/systemone`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(typesafePredicateBody(input, instructions)),
          signal: AbortSignal.timeout(TYPESAFE_REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw new AppError(
          "internal",
          `TypeSafe decisions request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!response.ok) throw requestError(response.status, await response.text().catch(() => ""));
      return parseNoul(await response.json().catch(() => undefined));
    },
  };
}
