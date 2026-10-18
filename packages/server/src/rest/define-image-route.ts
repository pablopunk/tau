import { createHash } from "node:crypto";
import type { ProjectIconImage, RouteDef, RouteInput } from "@tau/protocol";
import type { FastifyInstance, FastifyReply } from "fastify";
import { etagMatches } from "./etag-match";

type Handler<R extends RouteDef> = (input: RouteInput<R>) => Promise<ProjectIconImage | null>;

const hashOf = (data: Uint8Array) => createHash("sha1").update(data).digest("base64url");
const etagOf = (image: ProjectIconImage) => `"${image.etag ?? hashOf(image.data)}"`;

function setImageHeaders(reply: FastifyReply, image: ProjectIconImage) {
  reply
    .header("x-content-type-options", "nosniff")
    .header("cache-control", "no-cache")
    .header("etag", etagOf(image));
  if (image.contentType === "image/svg+xml") reply.header("content-security-policy", "sandbox");
}

function sendImage(reply: FastifyReply, image: ProjectIconImage) {
  setImageHeaders(reply, image);
  return reply.header("content-type", image.contentType).send(Buffer.from(image.data));
}

/** Registers an `image` route: raw bytes, or 404 when the handler has none. Always nosniff; SVG is sandboxed. */
export function defineImageRoute<R extends RouteDef>(
  app: FastifyInstance,
  route: R,
  handler: Handler<R>,
): void {
  app.route({
    method: route.method,
    url: route.path,
    schema: {
      ...(route.params && { params: route.params }),
      ...(route.query && { querystring: route.query }),
    },
    handler: async (request, reply) => {
      const image = await handler({ params: request.params, query: request.query } as RouteInput<R>);
      if (!image) return reply.code(404).send({ error: { code: "not_found", message: "No icon." } });
      if (etagMatches(request.headers["if-none-match"], etagOf(image))) {
        setImageHeaders(reply, image);
        return reply.code(304).send();
      }
      return sendImage(reply, image);
    },
  });
}
