import type { Core, DirectoryNode, NodeGroup } from "@tau/protocol";
import { notImplemented } from "../../not-implemented";
import type { Directory, DirectoryDeps } from "./ports";

const reject = (what: string) => () => Promise.reject(notImplemented(what));
const unsubscribe = () => () => undefined;

/** Placeholder `NodeGroup`: inert (no routes, no tombstones) until owner E fills it. The link layer must not call it while `NODE_CAPABILITIES` is empty. */
export function createInertGroup(): NodeGroup {
  return {
    localAnnounce: reject("NodeGroup.localAnnounce"),
    linkUp: () => undefined,
    linkDown: () => undefined,
    acceptAnnounce: reject("NodeGroup.acceptAnnounce"),
    acceptExpel: reject("NodeGroup.acceptExpel"),
    acceptAck: reject("NodeGroup.acceptAck"),
    expelSet: async () => [],
    acceptExpelSet: reject("NodeGroup.acceptExpelSet"),
    markUnsynced: () => undefined,
    createExpel: reject("NodeGroup.createExpel"),
    route: () => undefined,
    isTombstoned: () => false,
    neighbours: () => [],
    onTopology: unsubscribe,
    onTombstone: unsubscribe,
    recordSkew: () => undefined,
  };
}

/** TODO(E): announces, sequence, expiry, topology (`routing.ts` from protocol), tombstones, expel, forget, reset-identity. */
export function createDirectory(deps: DirectoryDeps): Directory {
  const directory: Core["nodes"]["directory"] = async () => {
    // Transitional shim: every peer is a direct neighbour one hop away.
    const peers = await deps.nodes.list();
    return peers.map(
      (node): DirectoryNode => ({
        ...node,
        direct: true,
        hops: 1,
        nextHop: node.id,
        via: null,
        skewMs: null,
        ghost: false,
        unsynced: false,
      }),
    );
  };
  return {
    group: createInertGroup(),
    directory,
    expulsions: async () => [],
    reset: async () => undefined,
    removal: () => undefined,
  };
}
