import type { LiveTransport } from "@/lib/api";
import type { LiveClient } from "./live-client";

const noop = () => {};

/** Stub: workstream D replaces the body (socket, reconnect with backoff, `applyImmutable`), never the signature. */
export function createLiveClient(_transport: LiveTransport): LiveClient {
  return {
    subscribe: () => noop,
    onChanged: () => noop,
    status: "closed",
    onStatus: () => noop,
    close: noop,
  };
}
