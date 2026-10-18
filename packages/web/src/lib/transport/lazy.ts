import type { ClientFrame } from "@tau/protocol";
import type { LiveHandlers, LiveSocket, StreamHandlers, StreamSocket, Transport } from "./types";

function lazyLiveSocket(load: () => Promise<Transport>, handlers: LiveHandlers): LiveSocket {
  let socket: LiveSocket | undefined;
  let closed = false;
  const pending: ClientFrame[] = [];
  void load().then((transport) => {
    if (closed) return;
    socket = transport.live.open(handlers);
    for (const frame of pending.splice(0)) socket.send(frame);
  });
  return {
    send: (frame) => (socket ? socket.send(frame) : pending.push(frame)),
    close: () => {
      closed = true;
      socket?.close();
    },
  };
}

function lazyStream(load: () => Promise<Transport>, path: string, handlers: StreamHandlers): StreamSocket {
  let socket: StreamSocket | undefined;
  let closed = false;
  const pending: Array<string | Uint8Array> = [];
  void load().then((transport) => {
    if (closed) return;
    socket = transport.openStream(path, handlers);
    for (const data of pending.splice(0)) socket.send(data);
  });
  return {
    send: (data) => (socket ? socket.send(data) : pending.push(data)),
    close: () => {
      closed = true;
      socket?.close();
    },
  };
}

/** A transport that is loaded on first use, so the fake can stay out of the production bundle. */
export function createLazyTransport(load: () => Promise<Transport>): Transport {
  let loading: Promise<Transport> | undefined;
  const loadOnce = () => {
    loading ??= load();
    return loading;
  };
  return {
    request: async (name, input) => (await loadOnce()).request(name, input),
    live: { open: (handlers) => lazyLiveSocket(loadOnce, handlers) },
    openStream: (path, handlers) => lazyStream(loadOnce, path, handlers),
  };
}
