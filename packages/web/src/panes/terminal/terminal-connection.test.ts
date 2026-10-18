import { describe, expect, it, vi } from "vitest";
import type { StreamHandlers } from "@/lib/transport/types";
import { createTerminalConnection, type TerminalStreamState } from "./terminal-connection";

function setup() {
  const sockets: Array<{ handlers: StreamHandlers; sent: Array<string | Uint8Array>; closed: boolean }> = [];
  const timers: Array<() => void> = [];
  const log: string[] = [];
  const states: TerminalStreamState[] = [];
  const connection = createTerminalConnection({
    open: (handlers) => {
      const socket = { handlers, sent: [] as Array<string | Uint8Array>, closed: false };
      sockets.push(socket);
      return { send: (data) => socket.sent.push(data), close: () => (socket.closed = true) };
    },
    sink: { write: (data) => log.push(new TextDecoder().decode(data)), reset: () => log.push("<reset>") },
    onState: (state) => states.push(state),
    setTimer: (run) => {
      timers.push(run);
      return () => {};
    },
  });
  return { connection, sockets, timers, log, states };
}

const ready = JSON.stringify({ type: "ready", status: "running", exitCode: null });

describe("terminal connection", () => {
  it("sends the size right after ready, then output goes to the sink", () => {
    const { connection, sockets, log } = setup();
    connection.sendResize(100, 30);
    expect(sockets[0]?.sent).toEqual([]);
    sockets[0]?.handlers.onMessage(ready);
    expect(sockets[0]?.sent).toEqual([JSON.stringify({ type: "resize", cols: 100, rows: 30 })]);
    sockets[0]?.handlers.onMessage(new TextEncoder().encode("hi"));
    expect(log).toEqual(["<reset>", "hi"]);
  });

  it("reconnects with backoff and resets the screen before the replay", () => {
    const { connection, sockets, timers, log, states } = setup();
    connection.sendResize(80, 24);
    sockets[0]?.handlers.onMessage(ready);
    sockets[0]?.handlers.onClose(1006, "");
    expect(states.at(-1)?.status).toBe("connecting");
    timers[0]?.();
    expect(sockets).toHaveLength(2);
    sockets[1]?.handlers.onMessage(ready);
    sockets[1]?.handlers.onMessage(new TextEncoder().encode("again"));
    expect(log).toEqual(["<reset>", "<reset>", "again"]);
    expect(sockets[1]?.sent).toEqual([JSON.stringify({ type: "resize", cols: 80, rows: 24 })]);
  });

  it("does not reconnect after exit or for an unknown terminal", () => {
    const first = setup();
    first.sockets[0]?.handlers.onMessage(ready);
    first.sockets[0]?.handlers.onMessage(JSON.stringify({ type: "exit", exitCode: 3 }));
    first.sockets[0]?.handlers.onClose(1000, "");
    expect(first.timers).toHaveLength(0);
    expect(first.states.at(-1)).toEqual({ status: "exited", exitCode: 3 });
    const second = setup();
    second.sockets[0]?.handlers.onClose(1008, "not_found");
    expect(second.timers).toHaveLength(0);
    expect(second.states.at(-1)?.status).toBe("closed");
    vi.fn();
  });
});
