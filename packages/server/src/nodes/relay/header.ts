import { DOMAIN_TAGS, signedPayload } from "@tau/protocol/identity";

/** What the origin signs about a request or an open (an open has no method, content type or body). */
export interface HeaderInput {
  readonly method?: string;
  readonly path: string;
  readonly query: string;
  readonly via: string;
  readonly contentType?: string;
  readonly bodyBytes?: number;
}

/** The origin side of `signRequestHeader`: same canonical text, signed by core (the key never leaves it). */
export function headerPayload(
  dest: string,
  origin: string,
  input: HeaderInput,
  ts: number,
  nonce: string,
): string {
  return signedPayload(
    DOMAIN_TAGS.request,
    dest,
    origin,
    encodeURIComponent(input.method ?? ""),
    encodeURIComponent(input.path),
    encodeURIComponent(input.query),
    encodeURIComponent(input.contentType ?? ""),
    input.bodyBytes === undefined ? "" : String(input.bodyBytes),
    encodeURIComponent(input.via),
    String(ts),
    nonce,
  );
}
