import { type Core, routes } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import { registerTerminalStream } from "../terminals/register-stream";
import { defineRoute } from "./define-route";

/**
 * REST half of terminals: no business logic, every route forwards to `core.terminals`.
 * Owner B: the stream WebSocket (`TERMINAL_STREAM_PATH`) lives in `server/src/terminals/**`.
 * `getTerminalsAvailable` answers `{ available }`; the list and open routes answer `not_found` when unavailable.
 */
export function registerTerminalRoutes(app: FastifyInstance, core: Core): void {
  const { terminals } = core;
  defineRoute(app, routes.getTerminalsAvailable, async () => ({ available: await terminals.available() }));
  defineRoute(app, routes.listTerminals, ({ params }) => terminals.list(params.id));
  defineRoute(app, routes.openTerminal, ({ params, body }) => terminals.open(params.id, body));
  defineRoute(app, routes.closeTerminal, ({ params }) => terminals.close(params.id));
  registerTerminalStream(app, core);
}
