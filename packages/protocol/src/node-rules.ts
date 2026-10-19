/** Refusals of `tau connect` that need no I/O. Every tau may link to every other: no chains, no loops. */
export function selfLinkRefusal(ownNodeId: string, peerNodeId: string | undefined): string | undefined {
  return peerNodeId !== undefined && peerNodeId === ownNodeId
    ? "That link points at this node itself."
    : undefined;
}

/** `tau connect` is refused when this tau already links to (or accepts) that node. */
export function alreadyLinkedRefusal(known: boolean): string | undefined {
  return known ? "This node is already linked. Run `tau disconnect` first to link it again." : undefined;
}
