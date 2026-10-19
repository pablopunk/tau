import { CAPABILITY_RELAY, type Core, forwardTtl, loopsBack, TRAIL_MAX } from "@tau/protocol";
import type { IncomingOpen } from "../link-mux";
import type { LinkRegistry, RegisteredLink } from "../link-registry";
import type { Closers } from "./closers";
import { POLICY, REFUSAL_REASONS } from "./refusals";
import { relayStream } from "./relay-pair";
import type { Refusal } from "./verify-local";

/** At most this many relayed streams per incoming link. */
export const RELAY_STREAMS_PER_LINK = 256;
const BUSY = 1013;

const refuse = (reason: string, code = POLICY): Refusal => ({ code, reason });

export interface Forwarder {
  /** Checks a routed frame for another node and joins it to the next hop; the refusal when it dies here. */
  forward(link: RegisteredLink, ownNodeId: string, frame: IncomingOpen): Refusal | undefined;
}

export function createForwarder(deps: { core: Core; registry: LinkRegistry; closers: Closers }): Forwarder {
  const counts = new Map<string, number>();
  const release = (nodeId: string) => counts.set(nodeId, (counts.get(nodeId) ?? 1) - 1);
  return {
    forward(link, ownNodeId, frame) {
      const { group } = deps.core.nodes;
      const trail = frame.trail ?? [];
      const ttl = forwardTtl(frame.ttl);
      if (loopsBack(ownNodeId, frame) || ttl === undefined) return refuse("ttl or loop");
      if (trail.length >= TRAIL_MAX || trail.at(-1) !== link.nodeId) return refuse("bad trail");
      if (!frame.origin || !frame.dest || frame.origin !== trail[0]) return refuse("bad origin");
      if (!link.capabilities.includes(CAPABILITY_RELAY)) return refuse("no relay");
      if (group.isTombstoned(frame.origin) || group.isTombstoned(frame.dest))
        return refuse(REFUSAL_REASONS.node_removed);
      const next = nextLink(deps.registry, group.route(frame.dest)?.nextHop, link);
      if (!next) return refuse(REFUSAL_REASONS.no_route);
      if ((counts.get(link.nodeId) ?? 0) >= RELAY_STREAMS_PER_LINK) return refuse("relay busy", BUSY);
      counts.set(link.nodeId, (counts.get(link.nodeId) ?? 0) + 1);
      const relayed = relayStream({
        inMux: link.mux,
        outMux: next.mux,
        frame: { ...frame, trail: [...trail, ownNodeId], ttl },
        onGone: () => release(link.nodeId),
      });
      deps.closers.add({ origin: frame.origin, first: trail[0] as string, ...relayed });
      return undefined;
    },
  };
}

function nextLink(
  registry: LinkRegistry,
  nextHop: string | undefined,
  from: RegisteredLink,
): RegisteredLink | undefined {
  const next = nextHop ? registry.linkOf(nextHop) : undefined;
  const usable = next && next.nodeId !== from.nodeId && next.capabilities.includes(CAPABILITY_RELAY);
  return usable ? next : undefined;
}
