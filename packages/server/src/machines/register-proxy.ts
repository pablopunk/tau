import { AppError, MACHINE_PROXY_PREFIX, MESSAGE_BODY_LIMIT, toErrorBody } from "@tau/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MachineGateway } from "./gateway";
import { filterProxyPath, filterResponseHeaders } from "./path-filter";
import { type ProxyStreamDeps, registerProxyStreams } from "./proxy-streams";

const PREFIX_PATTERN = new RegExp(`^${MACHINE_PROXY_PREFIX}/([^/?]+)(/[^?]*)?`);

function splitUrl(url: string): { machineId: string; rest: string; query: string } | undefined {
  const [pathPart = "", query = ""] = url.split(/\?(.*)/s);
  const match = PREFIX_PATTERN.exec(pathPart);
  if (!match) return undefined;
  const machineId = decodeURIComponent(match[1] ?? "");
  return { machineId, rest: match[2] ?? "", query };
}

async function proxyHttp(
  gateway: MachineGateway,
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
  const response = await gateway.request(parts.machineId, {
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
 * `/api/m/<machineId>/**` on the hub. Registered in an encapsulated scope so a raw-buffer parser passes bodies
 * through untouched (the machine validates). The guard has already required a device cookie. Owner G fills the gateway.
 */
export async function registerMachineProxy(app: FastifyInstance, deps: ProxyStreamDeps): Promise<void> {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: MESSAGE_BODY_LIMIT },
      (_request, body, done) => done(null, body),
    );
    registerProxyStreams(scope, deps);
    scope.all(`${MACHINE_PROXY_PREFIX}/:machineId/*`, { bodyLimit: MESSAGE_BODY_LIMIT }, (request, reply) =>
      proxyHttp(deps.gateway, deps.hubDeviceLabel, request, reply),
    );
  });
}
