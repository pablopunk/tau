import type { Core } from "@pi-everywhere/protocol";
import type { FastifyInstance } from "fastify";

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

/** Stub: workstream B (server + CLI) replaces the body, never the signature. */
export const createServer: CreateServer = async (_options) => {
  throw new Error("createServer is not implemented yet");
};
