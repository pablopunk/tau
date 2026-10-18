import type { RawData, WebSocket } from "ws";

const MESSAGE_TOO_BIG = 1009;

export function rawLength(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((total, part) => total + part.length, 0);
  return data instanceof ArrayBuffer ? data.byteLength : data.length;
}

/**
 * Must be the first line of every message handler: the shared server accepts up to `WS_MAX_PAYLOAD_BYTES`,
 * so each route refuses its own oversize frames, before any `toString()` or parse. Returns true when it closed.
 */
export function closeIfOversized(socket: WebSocket, data: RawData, capBytes: number): boolean {
  if (rawLength(data) <= capBytes) return false;
  socket.close(MESSAGE_TOO_BIG, "frame too large");
  return true;
}
