import type { Readable } from "node:stream";
import { AppError, MESSAGE_BODY_LIMIT, NODE_PROXY_PREFIX, toErrorBody } from "@tau/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { OWNER_DEVICE_ID } from "../security/guard";
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

function bodyTooLarge(): AppError {
  return new AppError("too_large", "The request body is too large.");
}

/**
 * Runs before the raw-buffer parser: rejects a non-owner on an `ownerOnly` route and refuses a declared body
 * the route would reject, so an over-limit upload never buffers to the 42 MiB transport ceiling and never
 * reaches the gateway. Unknown or denied paths fall through to `proxyHttp`, which answers 403/404.
 * Bodies without a declared length are counted while the parser below streams them.
 */
async function guardProxyRequest(request: FastifyRequest, payload: Readable): Promise<Readable> {
  const parts = splitUrl(request.url);
  if (!parts) return payload;
  const decision = filterProxyPath(request.method, parts.rest);
  if (!decision.allowed || decision.target.kind !== "http") return payload;
  if (decision.target.ownerOnly && request.deviceId !== OWNER_DEVICE_ID)
    throw new AppError("forbidden", "Only the owner can do this.");
  const declared = request.headers["content-length"];
  if (declared !== undefined && Number(declared) > decision.target.bodyLimit) throw bodyTooLarge();
  return payload;
}

/**
 * Buffers the proxied body like the default raw parser, but counts bytes against the matched route's own limit
 * (8 MiB for uploads) instead of the 42 MiB transport ceiling, for declared and chunked bodies alike.
 * Unknown paths fall back to the ceiling; `proxyHttp` answers them 403/404 without calling the gateway.
 */
function parseProxyBody(
  request: FastifyRequest,
  payload: Readable,
  done: (error: Error | null, body?: Buffer) => void,
): void {
  const parts = splitUrl(request.url);
  const decision = parts ? filterProxyPath(request.method, parts.rest) : undefined;
  const limit =
    decision?.allowed && decision.target.kind === "http" ? decision.target.bodyLimit : MESSAGE_BODY_LIMIT;
  let received = 0;
  let settled = false;
  const chunks: Buffer[] = [];
  const fail = (error: Error): void => {
    if (settled) return;
    settled = true;
    payload.removeListener("data", onData);
    payload.removeListener("end", onEnd);
    payload.removeListener("error", onEnd);
    done(error, undefined);
  };
  const onData = (chunk: Buffer): void => {
    received += chunk.length;
    if (received > limit) return void fail(bodyTooLarge());
    chunks.push(chunk);
  };
  const onEnd = (error?: unknown): void => {
    if (error instanceof Error) return void fail(error);
    if (settled) return;
    settled = true;
    done(null, Buffer.concat(chunks));
  };
  payload.on("data", onData);
  payload.on("end", () => onEnd());
  payload.on("error", onEnd);
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
  if (decision.target.ownerOnly && request.deviceId !== OWNER_DEVICE_ID)
    throw new AppError("forbidden", "Only the owner can do this.");
  const body = request.body instanceof Buffer ? request.body : undefined;
  if (body && body.length > decision.target.bodyLimit)
    throw new AppError("too_large", "The request body is too large.");
  const response = await gateway.request(parts.nodeId, {
    method: request.method,
    path: decision.path,
    query: parts.query,
    via: label(request.deviceId),
    contentType: request.headers["content-type"],
    body,
  });
  return reply.code(response.status).headers(filterResponseHeaders(response.headers)).send(response.body);
}

/**
 * `/api/n/<nodeId>/**` on the hub. Registered in an encapsulated scope so a raw-buffer parser passes bodies
 * through untouched (the node validates). The guard has already required a device cookie.
 */
export async function registerNodeProxy(app: FastifyInstance, deps: ProxyStreamDeps): Promise<void> {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { bodyLimit: MESSAGE_BODY_LIMIT }, parseProxyBody);
    scope.addHook("preParsing", async (request, _reply, payload) => guardProxyRequest(request, payload));
    registerProxyStreams(scope, deps);
    scope.all(`${NODE_PROXY_PREFIX}/:nodeId/*`, { bodyLimit: MESSAGE_BODY_LIMIT }, (request, reply) =>
      proxyHttp(deps.gateway, deps.viaLabel, request, reply),
    );
  });
}
