import { type Core, routes } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import { defineRoute } from "./define-route";

export function registerConnectorRoutes(app: FastifyInstance, core: Core): void {
  const { approvals, settings } = core;
  defineRoute(app, routes.setClaudeConnectors, ({ body }) => settings.setClaudeConnectors(body));
  defineRoute(app, routes.listApprovals, ({ params }) => approvals.list(params.id));
  defineRoute(app, routes.decideApproval, ({ params, body }) =>
    approvals.decide(params.id, params.toolUseId, body.decision),
  );
}
