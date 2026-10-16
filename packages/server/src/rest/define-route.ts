import type { RouteDef, RouteInput, RouteOutput } from "@pi-everywhere/protocol";
import type { FastifyInstance } from "fastify";

// biome-ignore lint/suspicious/noConfusingVoidType: Core methods without a result resolve to void
type Handler<R extends RouteDef> = (input: RouteInput<R>) => Promise<RouteOutput<R> | undefined | void>;

/** Registers one frozen protocol route; schemas come from the protocol, so the handler input is fully typed. */
export function defineRoute<R extends RouteDef>(app: FastifyInstance, route: R, handler: Handler<R>): void {
  app.route({
    method: route.method,
    url: route.path,
    ...(route.bodyLimit && { bodyLimit: route.bodyLimit }),
    schema: {
      ...(route.params && { params: route.params }),
      ...(route.body && { body: route.body }),
    },
    handler: async (request, reply) => {
      const input = { params: request.params, body: request.body } as RouteInput<R>;
      const output = await handler(input);
      reply.code(route.status);
      return route.status === 204 ? reply.send() : output;
    },
  });
}
