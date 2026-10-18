import type { Core } from "@tau/protocol";
import type { StreamHandlers, StreamSocket } from "./types";

const STREAM_PATH = /^\/api\/terminals\/([^/]+)\/stream$/;

/** The fake backend's terminal stream: `ready`, binary replay and live output, `exit`. Owner C extends it. */
export function openFakeStream(core: Core, path: string, handlers: StreamHandlers): StreamSocket {
  const id = STREAM_PATH.exec(path)?.[1];
  let detach: (() => void) | undefined;
  let closed = false;
  let write: (data: Uint8Array) => void = () => undefined;
  const frame = (value: object) => handlers.onMessage(JSON.stringify(value));
  queueMicrotask(async () => {
    if (id === undefined) return handlers.onClose(1008, "not_found");
    try {
      const attachment = await core.terminals.attach(decodeURIComponent(id), {
        onData: (data) => !closed && handlers.onMessage(data),
        onExit: (exitCode) => !closed && frame({ type: "exit", exitCode }),
      });
      if (closed) return attachment.detach();
      detach = attachment.detach;
      write = attachment.write;
      handlers.onOpen();
      frame({ type: "ready", status: attachment.status, exitCode: attachment.exitCode });
    } catch {
      handlers.onClose(1008, "not_found");
    }
  });
  return {
    send: (data) => (typeof data === "string" ? undefined : write(data)),
    close() {
      closed = true;
      detach?.();
    },
  };
}
