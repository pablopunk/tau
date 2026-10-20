import { type Core, routes } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import { defineRoute } from "./define-route";

/** `stopResourceCommand` is deliberately not owner-only, like `setClaudeConnectors`. */
export function registerResourceRoutes(app: FastifyInstance, core: Core): void {
  const { settings } = core;
  defineRoute(app, routes.setResources, ({ body }) => settings.setResources(body));
  defineRoute(app, routes.getResourceSupport, () => settings.resourceSupport());
  defineRoute(app, routes.getResourceActivity, () => settings.resourceActivity());
  defineRoute(app, routes.stopResourceCommand, ({ params }) => settings.stopResourceCommand(params.id));
}
