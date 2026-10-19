import { type LinkFrame, LinkFrameSchema } from "@tau/protocol";
import { Value } from "typebox/value";
import type { RawData } from "ws";

export function toBytes(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? Buffer.from(data) : data;
}

/** `undefined` for anything that is not exactly one control frame of the link schema. */
export function parseControlFrame(bytes: Buffer): LinkFrame | undefined {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return Value.Check(LinkFrameSchema, value) ? (value as LinkFrame) : undefined;
  } catch {
    return undefined;
  }
}

/** Close codes `ws` accepts on the wire; anything else (1005, 1006, 1015, junk) becomes 1011. */
export function wireCloseCode(code: number): number {
  const valid =
    (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999);
  return valid ? code : 1011;
}

/** A close reason is at most 123 bytes of UTF-8. */
export function clipReason(reason: string): string {
  return Buffer.from(reason)
    .subarray(0, 123)
    .toString("utf8")
    .replace(/\uFFFD+$/, "");
}

/** The frame's `query` has no leading `?`; both forms are accepted. */
export function targetOf(path: string, query: string): string {
  const bare = query.startsWith("?") ? query.slice(1) : query;
  return bare === "" ? path : `${path}?${bare}`;
}

/** A query that could split the request line: whitespace, `#`, a backslash or a control character. */
export function isUnsafeQuery(query: string): boolean {
  return [...query].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x20 || code === 0x7f || char === "#" || char === "\\";
  });
}
