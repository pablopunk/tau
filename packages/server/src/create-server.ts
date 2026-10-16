import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import type { Core } from "@pi-everywhere/protocol";
import Fastify, { type FastifyInstance } from "fastify";
import { handleError } from "./error-handler";
import { registerLive } from "./live/register-live";
import { allowEmptyJsonBodies } from "./rest/json-body";
import { registerRoutes } from "./rest/register-routes";
import { allowListForPort } from "./security/allow-list";
import { createGuard } from "./security/guard";
import { createSession } from "./security/session";
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
  /** Secret that opens a session: `/?token=…` is swapped for the `pie_<port>` cookie. Persisted by the CLI in `<home>/token`. */
  readonly token: string;
  /** Fastify logger, off by default. */
  readonly logger?: boolean;
}

export interface RunningServer {
  /** The Fastify instance, for `inject()` in tests. */
  readonly app: FastifyInstance;
  /** The port actually bound. */
  readonly port: number;
  /** `http://127.0.0.1:<port>`, without the token. */
  readonly origin: string;
  /** `origin/?token=…`: the URL a person opens. */
  readonly url: string;
  close(): Promise<void>;
}

export type CreateServer = (options: ServerOptions) => Promise<RunningServer>;

const DEFAULT_HOST = "127.0.0.1";

/** The port is only known after listening (port 0), so the guard reads it lazily. */
function createLazyGuard(token: string, getPort: () => number) {
  let guard: ReturnType<typeof createGuard> | undefined;
  return (...args: Parameters<ReturnType<typeof createGuard>>) => {
    const port = getPort();
    guard ??= createGuard({ allowList: allowListForPort(port), session: createSession(token, port) });
    return guard(...args);
  };
}

export const createServer: CreateServer = async (options) => {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  let boundPort = options.port;
  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket);
  allowEmptyJsonBodies(app);
  app.setErrorHandler(handleError);
  app.addHook(
    "onRequest",
    createLazyGuard(options.token, () => boundPort),
  );
  registerRoutes(app, options.core);
  registerLive(app, options.core);
  await registerStaticAssets(app, options.staticDir);
  try {
    await app.listen({ port: options.port, host: options.host ?? DEFAULT_HOST });
  } catch (error) {
    await app.close();
    throw error;
  }
  const address = app.server.address();
  boundPort = typeof address === "object" && address ? address.port : options.port;
  const origin = `http://${DEFAULT_HOST}:${boundPort}`;
  return {
    app,
    port: boundPort,
    origin,
    url: `${origin}/?token=${encodeURIComponent(options.token)}`,
    close: () => app.close(),
  };
};
