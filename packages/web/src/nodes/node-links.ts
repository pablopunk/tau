import type { Node, NodeLink, NodeLinkState } from "@tau/protocol";

const STATE_TEXT: Record<NodeLinkState, string> = {
  connecting: "Connecting…",
  linked: "Linked",
  reconnecting: "Reconnecting…",
  unreachable: "Unreachable",
  "update-required": "Update tau on that node",
  refused: "Refused",
  duplicate: "Duplicate identity",
  standby: "Standing by",
};

const DIRECTION_TEXT: Record<NodeLink["direction"], string> = {
  accepted: "It connected to this node",
  dialled: "This node connected to it",
};

export const linkStateText = (link: NodeLink): string => link.message ?? STATE_TEXT[link.state];

export const linkText = (link: NodeLink): string =>
  `${DIRECTION_TEXT[link.direction]}: ${linkStateText(link)}`;

/**
 * The links worth showing: a standby entry is a spare for recovery while another link to the same node lives, so it
 * is hidden then; when it is all there is, it shows as "Standing by".
 */
export function visibleLinks(node: Pick<Node, "links">): NodeLink[] {
  const live = node.links.filter((link) => link.state !== "standby");
  return live.length > 0 ? live : node.links.slice(0, 1);
}

/** This node was told it is no longer welcome: the other end refused it. */
export const wasRemoved = (node: Pick<Node, "links">): boolean =>
  node.links.some((link) => link.state === "refused" && /removed/i.test(link.message ?? ""));
