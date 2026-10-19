import type { HubLink } from "./nodes";

const NO_CHAINS = "This tau is linked to a hub, so other nodes cannot link to it. Disconnect it first.";
const NO_LOOPS = "Other nodes are linked to this tau, so it cannot link to a hub. Disconnect them first.";

/** No chains, no loops (two-way): a tau that is linked to a hub never accepts node links. */
export function acceptLinkRefusal(hub: Pick<HubLink, "state">): string | undefined {
  return hub.state === "none" ? undefined : NO_CHAINS;
}

/** `tau connect` is refused when this tau already has linked nodes. */
export function connectRefusal(linkedNodes: number): string | undefined {
  return linkedNodes > 0 ? NO_LOOPS : undefined;
}

/** `tau connect` is also refused when this tau already has a hub (one hub at a time). */
export function alreadyLinkedRefusal(hasHubFile: boolean): string | undefined {
  return hasHubFile ? "This tau is already linked to a hub. Run `tau disconnect` first." : undefined;
}
