import {
  API_PREFIX,
  LIVE_PATH,
  MESSAGE_BODY_LIMIT,
  type RouteDef,
  routes,
  TERMINAL_STREAM_PATH,
} from "@tau/protocol";

/** Routes that must never cross the hub: they would show or change the hub's own data. */
const DENIED_FIRST_SEGMENTS: ReadonlySet<string> = new Set([
  "access",
  "remote",
  "nodes",
  "update",
  "pair",
  "health",
  "n",
]);
const FASTIFY_DEFAULT_BODY_LIMIT = 1024 * 1024;

export type ProxyTarget =
  | { readonly kind: "http"; readonly bodyLimit: number; readonly ownerOnly: boolean }
  | { readonly kind: "live" }
  | { readonly kind: "terminal-stream"; readonly terminalId: string };

export type ProxyDecision =
  | { readonly allowed: true; readonly path: string; readonly target: ProxyTarget }
  | { readonly allowed: false; readonly status: 403 | 404; readonly reason: string };

const deny = (status: 403 | 404, reason: string): ProxyDecision => ({ allowed: false, status, reason });

interface Entry {
  readonly method: string;
  readonly segments: readonly string[];
  readonly target: (params: Record<string, string>) => ProxyTarget;
}

const segmentsOf = (path: string) => path.split("/").slice(1);

function httpEntry(route: RouteDef): Entry {
  return {
    method: route.method,
    segments: segmentsOf(route.path),
    target: () => ({
      kind: "http",
      bodyLimit: route.bodyLimit ?? FASTIFY_DEFAULT_BODY_LIMIT,
      ownerOnly: route.ownerOnly ?? false,
    }),
  };
}

const TABLE: readonly Entry[] = [
  ...Object.values(routes as Record<string, RouteDef>).map(httpEntry),
  { method: "GET", segments: segmentsOf(LIVE_PATH), target: () => ({ kind: "live" }) },
  {
    method: "GET",
    segments: segmentsOf(TERMINAL_STREAM_PATH),
    target: (params) => ({ kind: "terminal-stream", terminalId: params.id ?? "" }),
  },
];

/** `..`, an encoded dot, slash or backslash, a doubled slash, a query, a fragment or a control character. */
const FORBIDDEN_RAW = /\.\.|%2e|%2f|%5c|\/\/|[?#\\]/i;

/** What decoding must not produce: a slash, a backslash, a control character or a dot segment. */
const FORBIDDEN_DECODED = /[\\/]|^\.\.?$/;

const hasControlCharacter = (text: string): boolean =>
  [...text].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);

function decodeOnce(raw: string): string[] | undefined {
  try {
    const decoded = segmentsOf(raw).map((segment) => decodeURIComponent(segment));
    return decoded.some((segment) => FORBIDDEN_DECODED.test(segment) || hasControlCharacter(segment))
      ? undefined
      : decoded;
  } catch {
    return undefined;
  }
}

function matchEntry(
  entry: Entry,
  method: string,
  decoded: readonly string[],
): Record<string, string> | undefined {
  if (entry.method !== method || entry.segments.length !== decoded.length) return undefined;
  const params: Record<string, string> = {};
  for (const [index, template] of entry.segments.entries()) {
    const actual = decoded[index] ?? "";
    if (template.startsWith(":")) {
      if (actual === "") return undefined;
      params[template.slice(1)] = actual;
    } else if (template !== actual) return undefined;
  }
  return params;
}

/**
 * The path filter of `/api/n/<nodeId>/**`. `rawPath` is the part after the node id, as received and without
 * the query string. Decodes once, then matches the exact method and path against the routes table plus the two
 * socket paths. A denylisted or unknown path is refused here and again by a direct node (it is not a route there).
 */
export function filterProxyPath(method: string, rawPath: string): ProxyDecision {
  if (!rawPath.startsWith(`${API_PREFIX}/`)) return deny(404, "not an API path");
  if (FORBIDDEN_RAW.test(rawPath) || hasControlCharacter(rawPath)) return deny(403, "unsafe path");
  const decoded = decodeOnce(rawPath);
  if (!decoded) return deny(403, "bad encoding");
  if (DENIED_FIRST_SEGMENTS.has(decoded[1] ?? "")) return deny(403, "not available through a hub");
  for (const entry of TABLE) {
    const params = matchEntry(entry, method.toUpperCase(), decoded);
    if (params) return { allowed: true, path: rawPath, target: entry.target(params) };
  }
  return deny(404, "unknown route");
}

export const PROXY_BODY_LIMIT_MAX = MESSAGE_BODY_LIMIT;

const RESPONSE_HEADERS = new Set(["content-type", "cache-control", "content-disposition", "etag"]);
const REQUEST_HEADERS = new Set(["content-type", "accept", "if-none-match"]);

function pick(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  allowed: ReadonlySet<string>,
) {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (allowed.has(key) && typeof value === "string") out[key] = value;
  }
  return out;
}

/** Only these come back to the browser; `set-cookie` never does, so a node cannot plant a cookie on the hub's origin. */
export const filterResponseHeaders = (headers: Readonly<Record<string, string | string[] | undefined>>) =>
  pick(headers, RESPONSE_HEADERS);

/** Never `Host`, `Origin`, `Cookie` or `Authorization` from the browser. */
export const forwardableRequestHeaders = (headers: Readonly<Record<string, string | string[] | undefined>>) =>
  pick(headers, REQUEST_HEADERS);
