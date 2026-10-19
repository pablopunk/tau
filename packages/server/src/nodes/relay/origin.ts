import { randomBytes } from "node:crypto";
import { AppError, CAPABILITY_RELAY, type Core, ROUTE_TTL_START, type RoutedFields } from "@tau/protocol";
import type { WebSocket } from "ws";
import { sanitiseVia } from "../device-labels";
import type { GatewayRequest, GatewayResponse, GatewayStreamRequest } from "../gateway";
import type { LinkRegistry, RegisteredLink } from "../link-registry";
import { type HeaderInput, headerPayload } from "./header";
import { REFUSAL_REASONS, routedRefusal } from "./refusals";

interface Prepared {
  readonly link: RegisteredLink;
  readonly fields: RoutedFields;
}

const OFFLINE = "This node is offline.";

/** The origin of routed frames: finds the next hop and signs the header with the node key (held by core). */
export function createOrigin(deps: { core: Core; registry: LinkRegistry; now: () => number }) {
  const group = () => deps.core.nodes.group;

  async function prepare(dest: string, input: HeaderInput): Promise<Prepared> {
    if (group().isTombstoned(dest)) throw routedRefusal(REFUSAL_REASONS.node_removed) as AppError;
    const hop = group().route(dest)?.nextHop;
    const link = hop ? deps.registry.linkOf(hop) : undefined;
    if (!link) throw new AppError("not_found", OFFLINE);
    if (!link.capabilities.includes(CAPABILITY_RELAY))
      throw routedRefusal(REFUSAL_REASONS.no_route) as AppError;
    const self = await deps.core.nodes.self();
    const payload = headerPayload(
      dest,
      self.nodeId,
      input,
      deps.now(),
      randomBytes(12).toString("base64url"),
    );
    const fields: RoutedFields = {
      dest,
      origin: self.nodeId,
      originPublicKey: self.publicKey,
      payload,
      originSig: await deps.core.nodes.sign(payload),
      trail: [self.nodeId],
      ttl: ROUTE_TTL_START,
    };
    return { link, fields };
  }

  return {
    reachable: (nodeId: string): boolean =>
      !group().isTombstoned(nodeId) && group().route(nodeId) !== undefined,

    async request(dest: string, request: GatewayRequest): Promise<GatewayResponse> {
      const via = sanitiseVia(request.via);
      const bodyBytes = request.body && request.body.length > 0 ? request.body.length : undefined;
      const { link, fields } = await prepare(dest, {
        method: request.method,
        path: request.path,
        query: request.query,
        via,
        contentType: request.contentType,
        bodyBytes,
      });
      return link.request({ ...request, via }, fields);
    },

    openStream(dest: string, request: GatewayStreamRequest, socket: WebSocket): void {
      const via = sanitiseVia(request.via);
      socket.pause?.();
      prepare(dest, { path: request.path, query: request.query, via })
        .then(({ link, fields }) => link.openStream({ ...request, via }, socket, fields))
        .catch(() => socket.close(1013, "node unreachable"))
        .finally(() => socket.resume?.());
    },
  };
}
