import { usageError } from "../commands/cli-exit";

export interface ConnectTarget {
  readonly nodeUrl: string;
  readonly code: string;
  /** The other node's name from the link fragment, when the link carries one. */
  readonly peerLabel?: string;
  /** The other node's `nodeId` from `&node=`, when the link carries one. */
  readonly nodeId?: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** `https://` always; `http://` only for loopback (the same-Mac test with `--node http://127.0.0.1:<port>`). */
export function normalizeNodeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw usageError(`"${input}" is not a node URL. Example: https://abc123.opentunnel.xyz`);
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw usageError("The node URL must start with https:// (http:// only for 127.0.0.1 or localhost).");
  }
  return url.origin;
}

/**
 * `tau connect <link>` takes `https://<hostname>/pair#<code>[.<name>]`; `tau connect <short code> --node <url>`
 * takes the 8-character code. There is no unauthenticated endpoint that returns the node's name, so it rides in the link.
 */
export function parseConnectTarget(input: string, node?: string): ConnectTarget {
  if (!input.includes("/")) {
    if (node === undefined) throw usageError("A short code needs the node: tau connect <code> --node <url>");
    return { nodeUrl: normalizeNodeUrl(node), code: input.replace(/\s+/g, "") };
  }
  normalizeNodeUrl(input);
  const url = new URL(input);
  const fragment = url.hash.replace(/^#/, "");
  if (url.pathname !== "/pair" || fragment === "") {
    throw usageError("That is not a link code. Make one in Settings → Nodes on the other node.");
  }
  const [codeAndName = "", nodeId = ""] = fragment.split("&node=");
  const dot = codeAndName.indexOf(".");
  const code = dot < 0 ? codeAndName : codeAndName.slice(0, dot);
  const name = dot < 0 ? "" : decodeURIComponent(codeAndName.slice(dot + 1));
  return {
    nodeUrl: url.origin,
    code,
    ...(name !== "" && { peerLabel: name }),
    ...(nodeId !== "" && { nodeId: decodeURIComponent(nodeId) }),
  };
}
