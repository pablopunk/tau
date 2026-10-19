import { AppError, type RouteDef, type RouteInput, type RouteOutput } from "@tau/protocol";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { OWNER_DEVICE_ID } from "../security/guard";

// biome-ignore lint/suspicious/noConfusingVoidType: Core methods without a result resolve to void
type Handler<R extends RouteDef> = (
  input: RouteInput<R>,
  request: FastifyRequest,
) => Promise<RouteOutput<R> | undefined | void>;

export interface RouteOptions {
  /** Rejects every caller but the owner (`OWNER_DEVICE_ID`), including the pre-auth `""`, with `forbidden`. */
  readonly ownerOnly?: boolean;
}

async function requireOwner(request: FastifyRequest): Promise<void> {
  if (request.deviceId !== OWNER_DEVICE_ID) throw new AppError("forbidden", "Only the owner can do this.");
}

/** Registers one frozen protocol route; schemas come from the protocol, so the handler input is fully typed. */
export function defineRoute<R extends RouteDef>(
  app: FastifyInstance,
  route: R,
  handler: Handler<R>,
  options: RouteOptions = {},
): void {
  app.route({
    method: route.method,
    url: route.path,
    ...(route.bodyLimit && { bodyLimit: route.bodyLimit }),
    schema: {
      ...(route.params && { params: route.params }),
      ...(route.query && { querystring: route.query }),
      ...(route.body && { body: route.body }),
    },
    ...(options.ownerOnly && { preHandler: requireOwner }),
    handler: async (request, reply) => {
      const input = { params: request.params, query: request.query, body: request.body } as RouteInput<R>;
      const output = await handler(input, request);
      reply.code(route.status);
      if (route.status === 204) return reply.send();
      return output === null ? reply.type("application/json").send("null") : output;
    },
  });
}
