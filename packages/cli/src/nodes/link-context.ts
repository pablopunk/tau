import type { LegacyLinkFrame } from "@tau/protocol";
import type { LinkSender } from "./link-sender";

/** What a stream needs from its session. */
export interface LinkContext {
  readonly port: number;
  /** The master token for the loopback calls: never logged. */
  readonly token: string;
  readonly sender: LinkSender;
  sendControl(frame: LegacyLinkFrame): void;
  log(message: string): void;
}

/** One in-flight stream (a request or a socket) on the node. */
export interface Stream {
  onData(payload: Uint8Array, end: boolean, text: boolean): void;
  onClose(): void;
  /** The session ended: stop everything. */
  abort(): void;
}

export const loopbackHeaders = (context: LinkContext, hubDevice: string): Record<string, string> => ({
  host: `127.0.0.1:${context.port}`,
  authorization: `Bearer ${context.token}`,
  "x-tau-via": hubDevice,
});
