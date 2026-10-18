import { TERMINAL_STREAM_CLOSE_UNKNOWN, TerminalServerFrameSchema } from "@tau/protocol";
import { Value } from "typebox/value";
import { reconnectDelayMs } from "@/conversation/reconnect-delay";
import type { StreamHandlers, StreamSocket } from "@/lib/transport/types";

export interface TerminalStreamState {
  readonly status: "connecting" | "ready" | "exited" | "closed";
  readonly exitCode: number | null;
}

export interface TerminalSink {
  write(data: Uint8Array): void;
  reset(): void;
}

export interface TerminalConnectionDeps {
  readonly open: (handlers: StreamHandlers) => StreamSocket;
  readonly sink: TerminalSink;
  readonly onState: (state: TerminalStreamState) => void;
  readonly setTimer?: (run: () => void, ms: number) => () => void;
}

export interface TerminalConnection {
  sendInput(data: Uint8Array): void;
  sendResize(cols: number, rows: number): void;
  close(): void;
}

const defaultTimer = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
};

function parseFrame(text: string) {
  try {
    const value: unknown = JSON.parse(text);
    return Value.Check(TerminalServerFrameSchema, value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** One terminal stream: ready, binary output, exit; reattaches with backoff (the server replays, so the screen is reset first). */
export function createTerminalConnection(deps: TerminalConnectionDeps): TerminalConnection {
  const setTimer = deps.setTimer ?? defaultTimer;
  let socket: StreamSocket | undefined;
  let size: { cols: number; rows: number } | undefined;
  let attempt = 0;
  let ended = false;
  let ready = false;
  let stopped = false;
  let cancelRetry = () => {};

  const publish = (status: TerminalStreamState["status"], exitCode: number | null = null) =>
    deps.onState({ status, exitCode });
  const sendSize = () => ready && size && socket?.send(JSON.stringify({ type: "resize", ...size }));

  function onText(text: string) {
    const frame = parseFrame(text);
    if (!frame) return;
    if (frame.type === "ready") {
      attempt = 0;
      ready = true;
      deps.sink.reset();
      ended = frame.status === "exited";
      publish(ended ? "exited" : "ready", frame.exitCode);
      if (!ended) sendSize();
      return;
    }
    ended = true;
    publish("exited", frame.exitCode);
  }

  function onClose(code: number) {
    socket = undefined;
    ready = false;
    if (stopped || ended) return;
    if (code === TERMINAL_STREAM_CLOSE_UNKNOWN) return publish("closed");
    publish("connecting");
    cancelRetry = setTimer(connect, reconnectDelayMs(attempt++));
  }

  function connect() {
    socket = deps.open({
      onOpen: () => {},
      onMessage: (data) => (typeof data === "string" ? onText(data) : deps.sink.write(data)),
      onClose,
    });
  }

  connect();
  return {
    sendInput: (data) => ready && socket?.send(data),
    sendResize(cols, rows) {
      size = { cols, rows };
      if (!ended) sendSize();
    },
    close() {
      stopped = true;
      cancelRetry();
      socket?.close();
    },
  };
}
