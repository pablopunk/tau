import { type Static, Type } from "typebox";
import { API_PREFIX } from "./rest";
import { TerminalInfoSchema } from "./terminals";

/**
 * The terminal stream: one WebSocket per attached pane, `GET /api/terminals/:id/stream`.
 *
 * Exception to "every WebSocket frame is a TypeBox schema": raw terminal output (server to client) and input
 * bytes (client to server) are BINARY frames by design. Every TEXT frame is a schema below.
 *
 * Server to client: `ready`, then binary output (replay first, then live), then `exit`.
 * Client to server: binary input, and a `resize` text frame right after `ready`.
 * An unknown id closes with code 1008 and reason `not_found`; a client that cannot keep up closes with 1013.
 */
export const TERMINAL_STREAM_PATH = `${API_PREFIX}/terminals/:id/stream`;

export const terminalStreamPath = (id: string): string =>
  TERMINAL_STREAM_PATH.replace(":id", encodeURIComponent(id));

export const TERMINAL_STREAM_MAX_INPUT_BYTES = 64 * 1024;

/** The shared WebSocket server accepts frames up to this size (the machine link needs 256 KB chunks); each route enforces its own cap. */
export const WS_MAX_PAYLOAD_BYTES = 1024 * 1024;
/** `/live` client frames are `{type, conversationId}` only. */
export const LIVE_MAX_FRAME_BYTES = 64 * 1024;
export const TERMINAL_STREAM_MAX_REPLAY_FRAME_BYTES = 64 * 1024;
export const TERMINAL_STREAM_CLOSE_UNKNOWN = 1008;
export const TERMINAL_STREAM_CLOSE_SLOW = 1013;

export const TerminalReadyFrameSchema = Type.Object({
  type: Type.Literal("ready"),
  status: TerminalInfoSchema.properties.status,
  exitCode: TerminalInfoSchema.properties.exitCode,
});
export const TerminalExitFrameSchema = Type.Object({
  type: Type.Literal("exit"),
  exitCode: TerminalInfoSchema.properties.exitCode,
});
export const TerminalServerFrameSchema = Type.Union([TerminalReadyFrameSchema, TerminalExitFrameSchema]);
export type TerminalServerFrame = Static<typeof TerminalServerFrameSchema>;

export const TerminalResizeFrameSchema = Type.Object({
  type: Type.Literal("resize"),
  cols: Type.Integer({ minimum: 1, maximum: 500 }),
  rows: Type.Integer({ minimum: 1, maximum: 500 }),
});
export const TerminalClientFrameSchema = TerminalResizeFrameSchema;
export type TerminalClientFrame = Static<typeof TerminalClientFrameSchema>;
