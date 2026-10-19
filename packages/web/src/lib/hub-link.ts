import type { Node, NodeLinkState, NodeSelf } from "@tau/protocol";

/**
 * TRANSITIONAL (MVP13 Step 1 foundation): the 0.1.x "this tau's link to its hub" view, now DERIVED from the peers
 * (the first node with a dialled link) so the Nodes page keeps working until owner C rewrites it around
 * `Node.links`. The protocol's `HubLink` and `Core.nodes.hubState()` are gone.
 */
export interface HubLinkView {
  readonly state: "none" | NodeLinkState;
  readonly hubName: string | null;
  readonly hubUrl: string | null;
  readonly since: number | null;
  readonly message: string | null;
  /** The OS and name of this tau itself. */
  readonly os?: string;
  readonly name?: string;
}

export function hubLinkViewOf(nodes: readonly Node[], self: Pick<NodeSelf, "os" | "name">): HubLinkView {
  const peer = nodes.find((node) => node.links.some((link) => link.direction === "dialled"));
  const link = peer?.links.find((entry) => entry.direction === "dialled");
  if (!peer || !link) {
    return {
      state: "none",
      hubName: null,
      hubUrl: null,
      since: null,
      message: null,
      os: self.os,
      name: self.name,
    };
  }
  return {
    state: link.state,
    hubName: peer.name,
    hubUrl: null,
    since: link.since,
    message: link.message,
    os: self.os,
    name: self.name,
  };
}

/** The peer id `disconnectHub` cuts: the first node with a dialled link. */
export const hubPeerIdOf = (nodes: readonly Node[]): string | undefined =>
  nodes.find((node) => node.links.some((link) => link.direction === "dialled"))?.id;
