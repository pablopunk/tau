import { AppError, MESSAGE_BODY_LIMIT, NODE_PROXY_PREFIX, toErrorBody } from "@tau/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { NodeGateway } from "./gateway";
import { filterProxyPath, filterResponseHeaders } from "./path-filter";
import { type ProxyStreamDeps, registerProxyStreams } from "./proxy-streams";

const PREFIX_PATTERN = new RegExp(`^${NODE_PROXY_PREFIX}/([^/?]+)(/[^?]*)?`);

function splitUrl(url: string): { nodeId: string; rest: string; query: string } | undefined {
  const [pathPart = "", query = ""] = url.split(/\?(.*)/s);
  const match = PREFIX_PATTERN.exec(pathPart);
  if (!match) return undefined;
  const nodeId = decodeURIComponent(match[1] ?? "");
  return { nodeId, rest: match[2] ?? "", query };
}

async function proxyHttp(
  gateway: NodeGateway,
  label: (deviceId: string) => string,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const parts = splitUrl(request.url);
  if (!parts) throw new AppError("not_found", "Unknown route");
  const decision = filterProxyPath(request.method, parts.rest);
  if (!decision.allowed) {
    const code = decision.status === 403 ? "unauthorized" : "not_found";
    return reply.code(decision.status).send(toErrorBody(new AppError(code, decision.reason)));
  }
  if (decision.target.kind !== "http") throw new AppError("invalid_request", "That path is a socket.");
  const body = request.body instanceof Buffer ? request.body : undefined;
  if (body && body.length > decision.target.bodyLimit)
    throw new AppError("too_large", "The request body is too large.");
  const response = await gateway.request(parts.nodeId, {
    method: request.method,
    path: decision.path,
    query: parts.query,
    hubDevice: label(request.deviceId),
    contentType: request.headers["content-type"],
    body,
  });
  return reply.code(response.status).headers(filterResponseHeaders(response.headers)).send(response.body);
}

/**
 * `/api/n/<nodeId>/**` on the hub. Registered in an encapsulated scope so a raw-buffer parser passes bodies
 * through untouched (the node validates). The guard has already required a device cookie. Owner G fills the gateway.
 */
export async function registerNodeProxy(app: FastifyInstance, deps: ProxyStreamDeps): Promise<void> {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: MESSAGE_BODY_LIMIT },
      (_request, body, done) => done(null, body),
    );
    registerProxyStreams(scope, deps);
    scope.all(`${NODE_PROXY_PREFIX}/:nodeId/*`, { bodyLimit: MESSAGE_BODY_LIMIT }, (request, reply) =>
      proxyHttp(deps.gateway, deps.hubDeviceLabel, request, reply),
    );
  });
}
