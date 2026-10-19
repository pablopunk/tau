import { createHash } from "node:crypto";
import type { Peer } from "../peers/peers-store";

/**
 * The id of a dialled peer: its `nodeId` once known (from the pairing link or the first `hello`), else a
 * stable id derived from its URL. The dialler reports link state with this id (`Core.nodes.reportLink`).
 */
export function peerIdOf(peer: Pick<Peer, "url" | "nodeId">): string {
  return peer.nodeId ?? `u-${createHash("sha256").update(peer.url).digest("hex").slice(0, 12)}`;
}
