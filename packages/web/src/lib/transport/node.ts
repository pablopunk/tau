import { nodeApiPrefix } from "@tau/protocol";
import { createHttpTransport } from "./http";
import { createLazyTransport } from "./lazy";
import type { Transport } from "./types";

/**
 * The transport of one linked node: every request, `/api/live` socket and stream goes through the hub's proxy,
 * `/api/n/<nodeId>/api/...`. The hub's own node uses `createHttpTransport()` with no prefix.
 */
export function createNodeTransport(nodeId: string): Transport {
  if (import.meta.env.VITE_FAKE) {
    return createLazyTransport(() =>
      import("./fake").then((module) => module.createDefaultFakeNodeTransport(nodeId)),
    );
  }
  return createHttpTransport({ prefix: nodeApiPrefix(nodeId) });
}
