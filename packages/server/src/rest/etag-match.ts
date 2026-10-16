const stripWeak = (tag: string) => tag.trim().replace(/^W\//, "");

/** True when an If-None-Match header lists the current ETag (weak forms and `*` included). */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((tag) => tag.trim() === "*" || stripWeak(tag) === etag);
}
