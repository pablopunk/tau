import type { Core } from "@tau/protocol";
import type { HubFileStore } from "./hub-file";

/** Frozen in Phase 0: `serve.ts` calls exactly this. */
export interface LinkClientOptions {
  /** The port this server is bound to: the link client calls its own server on loopback. */
  readonly port: number;
  /** The master token, sent as `Authorization: Bearer`, with `Host: 127.0.0.1:<port>` and no Origin. */
  readonly token: string;
  readonly hubFile: HubFileStore;
  /** The client reports its state with `core.machines.reportLink(state)`. */
  readonly core: Core;
}

export interface LinkClient {
  /** Closes the hub socket and every in-flight stream. */
  stop(): Promise<void>;
}

export type StartLinkClient = (options: LinkClientOptions) => LinkClient;

/**
 * STUB for owner I: reads `hub.json` (and watches it, so `tau connect` and `tau disconnect` need no restart),
 * dials `wss://<hostname>/api/machines/link` with `Authorization: Bearer <machineSecret>` and the hub's Origin,
 * sends `hello`, pings every 15 s, serves `request` and `open` frames against the loopback server, and reports
 * `connecting`, `linked`, `reconnecting`, `unreachable` and `update-required` through `core.machines.reportLink`.
 */
export const startLinkClient: StartLinkClient = () => ({ stop: async () => undefined });
