import fastifyStatic from "@fastify/static";
import { API_PREFIX } from "@pi-everywhere/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendApiNotFound } from "./error-handler";

function isApiRequest(request: FastifyRequest): boolean {
  return request.url === API_PREFIX || request.url.startsWith(`${API_PREFIX}/`);
}

function acceptsHtml(request: FastifyRequest): boolean {
  return request.method === "GET" && (request.headers.accept ?? "").includes("text/html");
}

/** Serves the built web app; unknown HTML navigations fall back to `index.html` (client-side routing). */
export async function registerStaticAssets(
  app: FastifyInstance,
  staticDir: string | undefined,
): Promise<void> {
  if (staticDir) await app.register(fastifyStatic, { root: staticDir });
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    if (isApiRequest(request)) return sendApiNotFound(reply);
    if (staticDir && acceptsHtml(request)) return reply.sendFile("index.html");
    return reply.code(404).type("text/plain").send("Not found");
  });
}
