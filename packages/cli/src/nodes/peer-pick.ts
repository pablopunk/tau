import { type Peer, peerIdOf } from "@tau/core";
import { usageError } from "../commands/cli-exit";

/** The peer a `tau disconnect [node]` means: by name, node id, peer id or host. One peer needs no argument. */
export function pickPeer(peers: readonly Peer[], wanted: string | undefined): Peer | undefined {
  if (wanted === undefined) {
    if (peers.length > 1) {
      const names = peers.map((peer) => `${peer.name} (${peerIdOf(peer)})`).join(", ");
      throw usageError(`This node is linked to several nodes: name one. ${names}`);
    }
    return peers[0];
  }
  const lower = wanted.toLowerCase();
  const found = peers.find(
    (peer) =>
      peerIdOf(peer) === wanted ||
      peer.nodeId === wanted ||
      peer.name.toLowerCase() === lower ||
      new URL(peer.url).host === wanted,
  );
  if (!found) throw usageError(`No linked node "${wanted}". See \`tau nodes list\`.`);
  return found;
}
