import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import { type Core, WS_MAX_PAYLOAD_BYTES } from "@tau/protocol";
import Fastify, { type FastifyInstance } from "fastify";
import { handleError } from "./error-handler";
import { registerLive } from "./live/register-live";
import { createAttachPeer } from "./nodes/attach-peer";
import { createDeviceLabels } from "./nodes/device-labels";
import type { NodeGateway } from "./nodes/gateway";
import { createLinkRegistry } from "./nodes/link-registry";
import type { AttachPeer } from "./nodes/peer-seam";
import { registerNodeLink } from "./nodes/register-link";
import { registerNodeRoutes } from "./nodes/register-node-routes";
import { registerNodeProxy } from "./nodes/register-proxy";
import { startSummaryWriter } from "./nodes/summary-writer";
import { allowEmptyJsonBodies } from "./rest/json-body";
import { registerRoutes } from "./rest/register-routes";
import { type AllowList, allowListForPort, hostnameOfUrl } from "./security/allow-list";
import { closeSocketsOfGoneDevices, createDeviceSockets } from "./security/device-sockets";
import "./security/fastify-augmentation";
import { createGuard } from "./security/guard";
import { registerAccessRoutes } from "./security/register-access-routes";
import { registerLegacyLink } from "./security/register-legacy-link";
import { createSession } from "./security/session";
import { createTunnelListener, type TunnelListener } from "./security/tunnel-listener";
import { createTunnelTags } from "./security/tunnel-tags";
import { registerStaticAssets } from "./static-assets";

export interface ServerOptions {
  /** The only thing the server talks to. */
  readonly core: Core;
  /** Built web app (`packages/web/dist`). Without it the server serves the API only. */
  readonly staticDir?: string;
  /** Port to listen on; 0 picks a free one (tests). */
  readonly port: number;
  /** Interface to bind. Default `127.0.0.1`. */
  readonly host?: string;
  /** Secret that opens a session: `/?token=…` is swapped for the `tau_<port>` cookie. Persisted by the CLI in `<home>/token`. */
  readonly token: string;
  /** What `/api/n/<id>/**` talks to. Default: the registry of the links `attachPeer` runs (tests may stub it). */
  readonly gateway?: NodeGateway;
  /** Fastify logger, off by default. */
  readonly logger?: boolean;
}

export interface RunningServer {
  /** The Fastify instance, for `inject()` in tests. */
  readonly app: FastifyInstance;
  /** The port actually bound. */
  readonly port: number;
  /** The loopback port of the tunnel listener: the target of the tunnel route `@`. */
  readonly tunnelPort: number;
  /**
   * Runs a symmetric node link on a socket: the acceptor passes the upgraded link socket, the dialler (the CLI's
   * link client) the socket it opened. FROZEN seam; owner B fills `nodes/attach-peer.ts`.
   */
  readonly attachPeer: AttachPeer;
  /** `http://127.0.0.1:<port>`, without the token. */
  readonly origin: string;
  /** `origin/?token=…`: the URL a person opens. */
  readonly url: string;
  close(): Promise<void>;
}

export type CreateServer = (options: ServerOptions) => Promise<RunningServer>;

const DEFAULT_HOST = "127.0.0.1";

/** Keeps the allow-list's tunnel hostname equal to the core's remote URL, now and after every `remote` change. */
function followTunnelHostname(core: Core, list: () => AllowList | undefined): () => void {
  const sync = () =>
    void core.remote.status().then(
      (status) => list()?.setTunnelHostname(hostnameOfUrl(status.url)),
      () => undefined,
    );
  sync();
  return core.onChange((change) => {
    if (change.resource === "remote") sync();
  });
}

export const createServer: CreateServer = async (options) => {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  let boundPort = options.port;
  let allowList: AllowList | undefined;
  const tags = createTunnelTags();
  const sockets = createDeviceSockets();
  const session = () => createSession(options.token, boundPort);
  const guard = (() => {
    let built: ReturnType<typeof createGuard> | undefined;
    return (...args: Parameters<ReturnType<typeof createGuard>>) => {
      allowList ??= allowListForPort(boundPort);
      built ??= createGuard({
        session: session(),
        access: options.core.access,
        tunnel: tags,
        hostnames: () => allowList as AllowList,
      });
      return built(...args);
    };
  })();
  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket, { options: { maxPayload: WS_MAX_PAYLOAD_BYTES } });
  allowEmptyJsonBodies(app);
  app.setErrorHandler(handleError);
  app.decorateRequest("deviceId", "");
  app.addHook("onRequest", guard);
  registerRoutes(app, options.core, sockets);
  registerAccessRoutes(app, { core: options.core, tunnel: tags, sockets });
  registerLive(app, options.core, sockets);
  const labels = createDeviceLabels(options.core);
  const links = createLinkRegistry(options.core);
  const gateway = options.gateway ?? links.gateway;
  let attachPeer: AttachPeer | undefined;
  registerNodeRoutes(app, { core: options.core, sockets, gateway });
  registerNodeLink(app, { sockets, attachPeer: () => attachPeer as AttachPeer });
  registerLegacyLink(app);
  await registerNodeProxy(app, { sockets, gateway, viaLabel: labels.label });
  await registerStaticAssets(app, options.staticDir);
  const tunnel: TunnelListener = createTunnelListener({
    app,
    tags,
    hostname: () => allowList?.tunnelHostname(),
  });
  let stopFollowing = () => {};
  let stopReaping = () => {};
  let stopSummaries = () => {};
  try {
    await app.listen({ port: options.port, host: options.host ?? DEFAULT_HOST });
    boundPort = portOf(app.server.address(), options.port);
    allowList = allowListForPort(boundPort);
    stopSummaries = startSummaryWriter(options.core, gateway);
    stopFollowing = followTunnelHostname(options.core, () => allowList);
    stopReaping = options.core.onChange((change) => {
      if (change.resource === "devices") void closeSocketsOfGoneDevices(options.core, sockets);
    });
  } catch (error) {
    await app.close();
    throw error;
  }
  attachPeer = createAttachPeer({
    core: options.core,
    port: boundPort,
    token: options.token,
    registry: links,
  });
  const { port: tunnelPort } = await tunnel.start();
  const origin = `http://${DEFAULT_HOST}:${boundPort}`;
  return {
    app,
    port: boundPort,
    attachPeer,
    tunnelPort,
    origin,
    url: `${origin}/?token=${encodeURIComponent(options.token)}`,
    close: async () => {
      labels.stop();
      stopFollowing();
      stopReaping();
      stopSummaries();
      await tunnel.close();
      await app.close();
    },
  };
};

function portOf(address: ReturnType<FastifyInstance["server"]["address"]>, fallback: number): number {
  return typeof address === "object" && address ? address.port : fallback;
}
