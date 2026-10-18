import { usageError } from "../commands/cli-exit";

export interface ConnectTarget {
  readonly hubUrl: string;
  readonly code: string;
  /** The hub's name from the link fragment, when the link carries one. */
  readonly hubName?: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** `https://` always; `http://` only for loopback (the same-Mac test with `--hub http://127.0.0.1:<port>`). */
export function normalizeHubUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw usageError(`"${input}" is not a hub URL. Example: https://abc123.opentunnel.xyz`);
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw usageError("The hub URL must start with https:// (http:// only for 127.0.0.1 or localhost).");
  }
  return url.origin;
}

/**
 * `tau connect <link>` takes `https://<hostname>/pair#<code>[.<name>]`; `tau connect <short code> --hub <url>`
 * takes the 8-character code. There is no unauthenticated endpoint that returns the hub's name, so it rides in the link.
 */
export function parseConnectTarget(input: string, hub?: string): ConnectTarget {
  if (!input.includes("/")) {
    if (hub === undefined) throw usageError("A short code needs the hub: tau connect <code> --hub <url>");
    return { hubUrl: normalizeHubUrl(hub), code: input.replace(/\s+/g, "") };
  }
  normalizeHubUrl(input);
  const url = new URL(input);
  const fragment = url.hash.replace(/^#/, "");
  if (url.pathname !== "/pair" || fragment === "") {
    throw usageError("That is not a link code. Make one in Settings → Machines on the hub.");
  }
  const dot = fragment.indexOf(".");
  const code = dot < 0 ? fragment : fragment.slice(0, dot);
  const name = dot < 0 ? "" : decodeURIComponent(fragment.slice(dot + 1));
  return { hubUrl: url.origin, code, ...(name !== "" && { hubName: name }) };
}
