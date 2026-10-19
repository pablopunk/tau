import {
  LIVE_MAX_FRAME_BYTES,
  LIVE_PATH,
  NODE_PROXY_PREFIX,
  TERMINAL_STREAM_MAX_INPUT_BYTES,
  TERMINAL_STREAM_PATH,
} from "@tau/protocol";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DeviceSockets } from "../security/device-sockets";
import { closeIfOversized } from "../ws-frame-cap";
import type { NodeGateway } from "./gateway";

export interface ProxyStreamDeps {
  readonly sockets: DeviceSockets;
  readonly gateway: NodeGateway;
  /** A label for the audit header, from the device list; the device id when unknown. */
  readonly viaLabel: (deviceId: string) => string;
}

type StreamParams = { nodeId: string; id?: string };

function queryOf(request: FastifyRequest): string {
  const index = request.url.indexOf("?");
  return index < 0 ? "" : request.url.slice(index + 1);
}

function hubStream(
  app: FastifyInstance,
  deps: ProxyStreamDeps,
  hubPath: string,
  nodePath: (p: StreamParams) => string,
  capBytes: number,
) {
  app.get<{ Params: StreamParams }>(hubPath, { websocket: true }, (socket, request) => {
    const { nodeId } = request.params;
    if (!deps.sockets.addProxied(request.deviceId, nodeId, socket)) return;
    // The first line of every message handler: refuse by raw length before any parse .
    socket.on("message", (data) => void closeIfOversized(socket, data, capBytes));
    deps.gateway.openStream(
      nodeId,
      {
        path: nodePath(request.params),
        query: queryOf(request),
        via: deps.viaLabel(request.deviceId),
      },
      socket,
    );
  });
}

/** Hub-side `/api/n/<id>/api/live` and `/api/n/<id>/api/terminals/:id/stream`, with the 64 KB caps as the first line. */
export function registerProxyStreams(app: FastifyInstance, deps: ProxyStreamDeps): void {
  hubStream(app, deps, `${NODE_PROXY_PREFIX}/:nodeId${LIVE_PATH}`, () => LIVE_PATH, LIVE_MAX_FRAME_BYTES);
  hubStream(
    app,
    deps,
    `${NODE_PROXY_PREFIX}/:nodeId${TERMINAL_STREAM_PATH}`,
    (params) => TERMINAL_STREAM_PATH.replace(":id", encodeURIComponent(params.id ?? "")),
    TERMINAL_STREAM_MAX_INPUT_BYTES,
  );
}
