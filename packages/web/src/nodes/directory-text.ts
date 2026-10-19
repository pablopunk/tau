import type { DirectoryNode } from "@tau/protocol";

/** A clock further than this from ours makes routed requests fail (the server window is 120 s). */
export const SKEW_LIMIT_MS = 120_000;

/** The group cap: a 17th live node is ignored by the others. */
export const GROUP_CAP = 16;

/** "via Homelab" for a routed node, `undefined` for a neighbour. */
export const viaText = (node: Pick<DirectoryNode, "direct" | "via">): string | undefined =>
  node.direct || !node.via ? undefined : `via ${node.via}`;

export const hopsText = (hops: number): string => `${hops} ${hops === 1 ? "hop" : "hops"}`;

/** "1 hop", "2 hops · via Homelab", plus "Not announcing" for a ghost. */
export const placeText = (node: Pick<DirectoryNode, "direct" | "via" | "hops" | "ghost">): string =>
  [hopsText(node.hops), viaText(node), node.ghost ? "Not announcing" : undefined].filter(Boolean).join(" · ");

export const hasClockSkew = (node: Pick<DirectoryNode, "skewMs">): boolean =>
  node.skewMs !== null && Math.abs(node.skewMs) > SKEW_LIMIT_MS;

export function skewText(node: Pick<DirectoryNode, "name" | "skewMs">): string {
  const minutes = Math.round(Math.abs(node.skewMs ?? 0) / 60_000);
  const side = (node.skewMs ?? 0) > 0 ? "ahead" : "behind";
  return `Clock skew with ${node.name}: its clock is ${minutes} min ${side}. Requests to it may be refused.`;
}

/** This node plus every node that is not a ghost. */
export const liveCount = (nodes: readonly Pick<DirectoryNode, "ghost">[]): number =>
  1 + nodes.filter((node) => !node.ghost).length;

export const isGroupFull = (nodes: readonly Pick<DirectoryNode, "ghost">[]): boolean =>
  liveCount(nodes) >= GROUP_CAP;

export const GROUP_FULL_TEXT = `This group has ${GROUP_CAP} nodes, the most tau allows. A 17th node is ignored until one is removed.`;
