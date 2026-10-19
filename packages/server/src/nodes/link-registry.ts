import { AppError, type Core, type LinkRole } from "@tau/protocol";
import type { WebSocket } from "ws";
import { arbitrateDuplicateLink, type LinkFacts } from "./duplicate-links";
import type {
  CloseReason,
  GatewayRequest,
  GatewayResponse,
  GatewayStreamRequest,
  NodeGateway,
} from "./gateway";

const OFFLINE = "This node is offline.";
const FLAP_WINDOW_MS = 60_000;
const FLAP_LIMIT = 3;
const DUPLICATE = 4002;
const REVOKED = 1008;
const DISCONNECTED = 1000;

/** What the registry needs from an established link. */
export interface RegisteredLink {
  readonly role: LinkRole;
  /** The peer id the link was attached with (device id or `peers.json` id). */
  readonly peerId: string;
  /** The peer's verified `nodeId`. */
  readonly nodeId: string;
  facts(): LinkFacts;
  close(code?: number, reason?: string, bye?: boolean): void;
  request(request: GatewayRequest): Promise<GatewayResponse>;
  openStream(request: GatewayStreamRequest, socket: WebSocket): void;
}

export type Admission =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: number; readonly reason: string };

export interface LinkRegistry {
  readonly gateway: NodeGateway;
  /** Decides who keeps the place of `nodeId`: the link, or the one already there. Synchronous, so two races resolve in order. */
  admit(link: RegisteredLink): Admission;
  /** `true` when `link` was the registered one (and now is not). */
  release(link: RegisteredLink): boolean;
}

/** One link per `nodeId`; the gateway the proxy plugin and the summary writer talk to. */
export function createLinkRegistry(core: Core, now: () => number = Date.now): LinkRegistry {
  const links = new Map<string, RegisteredLink>();
  const replacements = new Map<string, number[]>();

  const recentReplacements = (nodeId: string): number[] => {
    const recent = (replacements.get(nodeId) ?? []).filter((at) => now() - at < FLAP_WINDOW_MS);
    replacements.set(nodeId, recent);
    return recent;
  };
  const refuse = (_link: RegisteredLink, code: number, reason: string): Admission => {
    return { ok: false, code, reason };
  };
  const flapped = (link: RegisteredLink): Admission => {
    if (link.role === "dialler")
      core.nodes.reportLink(link.peerId, { state: "duplicate", message: "duplicate identity", since: now() });
    return refuse(link, DUPLICATE, "duplicate identity");
  };
  /** The arbiter says the loser's device or `peers.json` entry must go (core has only seen the winner). */
  const dropLoser = (loser: RegisteredLink) => void core.nodes.forget(loser.peerId).catch(() => undefined);
  const replace = (existing: RegisteredLink, incoming: RegisteredLink, code: number) => {
    links.delete(existing.nodeId);
    links.set(incoming.nodeId, incoming);
    existing.close(code, "replaced by a newer link");
  };
  const byPeer = (id: string) => [...links.values()].find((link) => link.peerId === id);
  const online = (nodeId: string) => links.get(nodeId);

  const gateway: NodeGateway = {
    isOnline: (nodeId) => online(nodeId) !== undefined,
    request(nodeId, request) {
      const link = online(nodeId);
      return link ? link.request(request) : Promise.reject(new AppError("not_found", OFFLINE));
    },
    openStream(nodeId, request, socket) {
      const link = online(nodeId);
      if (!link) return void socket.close(1013, "node offline");
      link.openStream(request, socket);
    },
    closeNode(nodeId, reason: CloseReason = "revoked") {
      const link = online(nodeId) ?? byPeer(nodeId);
      link?.close(reason === "revoked" ? REVOKED : DISCONNECTED, reason, true);
    },
  };

  return {
    gateway,
    admit(incoming) {
      const existing = links.get(incoming.nodeId);
      if (!existing) {
        links.set(incoming.nodeId, incoming);
        return { ok: true };
      }
      const verdict = arbitrateDuplicateLink(existing.facts(), incoming.facts());
      if (verdict.revokeLoser) dropLoser(verdict.survivor === "existing" ? incoming : existing);
      if (verdict.survivor === "existing") return refuse(incoming, verdict.loserCode, "duplicate link");
      if (verdict.case === "reconnect") {
        if (recentReplacements(incoming.nodeId).length >= FLAP_LIMIT) return flapped(incoming);
        recentReplacements(incoming.nodeId).push(now());
      }
      replace(existing, incoming, verdict.loserCode);
      return { ok: true };
    },
    release(link) {
      if (links.get(link.nodeId) !== link) return false;
      links.delete(link.nodeId);
      return true;
    },
  };
}
