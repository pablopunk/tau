import type { DirectoryNode, Node } from "@tau/protocol";

/** A neighbour as the directory reports it: one hop, no via, no skew. */
export const asDirectory = (nodes: readonly Node[]): DirectoryNode[] =>
  nodes.map((node) => ({
    ...node,
    direct: true,
    hops: 1,
    nextHop: node.id,
    via: null,
    skewMs: null,
    ghost: false,
    unsynced: false,
  }));
