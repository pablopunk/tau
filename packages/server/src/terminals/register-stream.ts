import { type Core, TERMINAL_STREAM_MAX_INPUT_BYTES, TERMINAL_STREAM_PATH } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import { TerminalStream } from "./stream-connection";

export function registerTerminalStream(app: FastifyInstance, core: Core): void {
  // One shared socket server, so the cap also applies to /live. Safe: its client frames are `{type, conversationId}` only (`ClientFrameSchema`), far below 64 KB.
  app.websocketServer.options.maxPayload = TERMINAL_STREAM_MAX_INPUT_BYTES;
  app.get<{ Params: { id: string } }>(TERMINAL_STREAM_PATH, { websocket: true }, (socket, request) => {
    new TerminalStream(socket, core, request.params.id, (error) => request.log.error(error));
  });
}
