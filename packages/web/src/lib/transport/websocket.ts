import { decodeServerFrame, encodeFrame, LIVE_PATH } from "@tau/protocol";
import type { LiveHandlers, LiveSocket, LiveTransport } from "./types";

function liveUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${LIVE_PATH}`;
}

export function createWebSocketTransport(): LiveTransport {
  return {
    open(handlers: LiveHandlers): LiveSocket {
      const socket = new WebSocket(liveUrl());
      socket.addEventListener("open", () => handlers.onOpen());
      socket.addEventListener("close", () => handlers.onClose());
      socket.addEventListener("message", (event) => {
        const frame = typeof event.data === "string" ? decodeServerFrame(event.data) : undefined;
        if (frame) handlers.onFrame(frame);
      });
      return {
        send: (frame) => socket.send(encodeFrame(frame)),
        close: () => socket.close(),
      };
    },
  };
}
