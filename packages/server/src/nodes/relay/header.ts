import { type RequestHeaderFields, requestPayload } from "@tau/protocol/identity";

/** What the origin signs about a request or an open (an open has no method, content type or body). */
export interface HeaderInput {
  readonly method?: string;
  readonly path: string;
  readonly query: string;
  readonly via: string;
  readonly contentType?: string;
  readonly bodyBytes?: number;
}

/** The origin side of `signRequestHeader`: the same `requestPayload`, signed by core (the key never leaves it). */
export function headerPayload(
  dest: string,
  origin: string,
  input: HeaderInput,
  ts: number,
  nonce: string,
): string {
  const fields: RequestHeaderFields = { dest, method: input.method ?? "", ...input };
  return requestPayload(fields, origin, ts, nonce);
}
