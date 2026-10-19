import {
  API_PREFIX,
  AppError,
  ERROR_STATUS,
  NODE_LINK_LEGACY_PATH,
  NODE_LINK_PATH,
  PAIR_PAGE_PATH,
  routes,
  toErrorBody,
} from "@tau/protocol";
import type { FastifyReply, FastifyRequest } from "fastify";

export function pathOf(request: FastifyRequest): string {
  return request.url.split("?")[0] ?? "";
}

export function isApiPath(request: FastifyRequest): boolean {
  const path = pathOf(request);
  return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
}

export function isWebSocketUpgrade(request: FastifyRequest): boolean {
  return request.headers.upgrade?.toLowerCase() === "websocket";
}

export function needsOriginCheck(request: FastifyRequest): boolean {
  return request.method !== "GET" || isWebSocketUpgrade(request);
}

function hasBody(request: FastifyRequest): boolean {
  const length = Number(request.headers["content-length"] ?? 0);
  return length > 0 || request.headers["transfer-encoding"] !== undefined;
}

const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;

export function rejectApi(reply: FastifyReply, error: AppError) {
  return reply.code(ERROR_STATUS[error.code]).send(toErrorBody(error));
}

export function rejectContentType(request: FastifyRequest, reply: FastifyReply): void {
  if (!hasBody(request) || JSON_CONTENT_TYPE.test(request.headers["content-type"] ?? "")) return;
  rejectApi(reply, new AppError("invalid_request", "Content-Type must be application/json"));
}

/** The unauthenticated surface, on every socket: the pair page, redeem and health. Nothing else. */
export function isOpenSurface(request: FastifyRequest): boolean {
  const path = pathOf(request);
  if (request.method === "GET") return path === PAIR_PAGE_PATH || path === routes.getHealth.path;
  return request.method === "POST" && path === routes.redeemPairing.path;
}

const BEARER = /^Bearer ([^\s]+)$/i;

export function bearerOf(request: FastifyRequest): string | undefined {
  return BEARER.exec(request.headers.authorization ?? "")?.[1];
}

const NODE_LINK_PATHS: ReadonlySet<string> = new Set([NODE_LINK_PATH, NODE_LINK_LEGACY_PATH]);

/**
 * Exactly `GET /api/nodes/link` (or the 0.1.x alias `/api/machines/link`) with `Upgrade: websocket`: the only
 * places a node secret is looked at. The alias exists so a 0.1.x dialler is upgraded and then told to update
 * (close 4001) instead of being answered 401, which it reads as "refused".
 */
export function isNodeLink(request: FastifyRequest): boolean {
  return request.method === "GET" && NODE_LINK_PATHS.has(pathOf(request)) && isWebSocketUpgrade(request);
}
