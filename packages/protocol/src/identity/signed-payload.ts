/** One domain tag per kind of signed thing, so a signature of one kind can never be replayed as another. */
export const DOMAIN_TAGS = {
  proof: "tau-proof-v1",
  announce: "tau-announce-v1",
  expel: "tau-expel-v1",
  request: "tau-req-v1",
  ack: "tau-ack-v1",
} as const;
export type DomainTag = (typeof DOMAIN_TAGS)[keyof typeof DOMAIN_TAGS];

const SEPARATOR = "|";

/** `tag|field|field…`; a field may not contain the separator (nothing is escaped, nothing is ambiguous). */
export function signedPayload(tag: DomainTag, ...fields: readonly string[]): string {
  for (const field of fields) {
    if (field.includes(SEPARATOR)) throw new RangeError("A signed field may not contain '|'");
  }
  return [tag, ...fields].join(SEPARATOR);
}

/** The fields of a payload, or `undefined` when the tag or the field count differs. */
export function parseSignedPayload(
  payload: string,
  tag: DomainTag,
  fieldCount: number,
): string[] | undefined {
  const parts = payload.split(SEPARATOR);
  return parts[0] === tag && parts.length === fieldCount + 1 ? parts.slice(1) : undefined;
}
