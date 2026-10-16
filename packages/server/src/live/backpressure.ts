import type { WebSocket } from "ws";

const HIGH_WATER_MARK_BYTES = 1024 * 1024;
const POLL_MS = 10;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once the socket's send buffer has drained (or the socket is no longer open). */
export async function waitForDrain(socket: WebSocket): Promise<void> {
  while (socket.readyState === socket.OPEN && socket.bufferedAmount > HIGH_WATER_MARK_BYTES) {
    await sleep(POLL_MS);
  }
}
