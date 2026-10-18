import { API_PREFIX, AppError, ERROR_STATUS, toErrorBody } from "@tau/protocol";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type AllowList, isAllowedHost, isAllowedOrigin } from "./allow-list";
import type { Session } from "./session";
import { SESSION_START_PAGE } from "./session-start-page";
import { UNAUTHORIZED_PAGE } from "./unauthorized-page";

export interface GuardOptions {
  readonly allowList: AllowList;
  readonly session: Session;
}

const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;

function isApiPath(request: FastifyRequest): boolean {
  const path = request.url.split("?")[0] ?? "";
  return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
}

function isWebSocketUpgrade(request: FastifyRequest): boolean {
  return request.headers.upgrade?.toLowerCase() === "websocket";
}

function needsOriginCheck(request: FastifyRequest): boolean {
  return request.method !== "GET" || isWebSocketUpgrade(request);
}

function hasBody(request: FastifyRequest): boolean {
  const length = Number(request.headers["content-length"] ?? 0);
  return length > 0 || request.headers["transfer-encoding"] !== undefined;
}

function rejectApi(reply: FastifyReply, error: AppError) {
  return reply.code(ERROR_STATUS[error.code]).send(toErrorBody(error));
}

function sendUnauthenticated(request: FastifyRequest, reply: FastifyReply) {
  if (isApiPath(request)) {
    return rejectApi(reply, new AppError("unauthorized", "Open the URL printed in your terminal"));
  }
  return reply.code(401).type("text/html; charset=utf-8").send(UNAUTHORIZED_PAGE);
}

const BEARER = /^Bearer ([^\s]+)$/i;

function bearerOf(request: FastifyRequest): string | undefined {
  return BEARER.exec(request.headers.authorization ?? "")?.[1];
}

function hasForeignOrigin(allowList: AllowList, request: FastifyRequest): boolean {
  const { origin } = request.headers;
  return origin !== undefined && !isAllowedOrigin(allowList, origin);
}

function rejectContentType(request: FastifyRequest, reply: FastifyReply): void {
  if (!hasBody(request) || JSON_CONTENT_TYPE.test(request.headers["content-type"] ?? "")) return;
  rejectApi(reply, new AppError("invalid_request", "Content-Type must be application/json"));
}

/** Runs before routing: Host, Origin, token exchange, cookie, then content type. */
export function createGuard({ allowList, session }: GuardOptions) {
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!isAllowedHost(allowList, request.headers.host)) {
      return void reply.code(403).type("text/plain").send("Forbidden host");
    }
    if (request.headers.authorization !== undefined) {
      if (!session.isValidToken(bearerOf(request))) return void sendUnauthenticated(request, reply);
      if (hasForeignOrigin(allowList, request)) {
        return void reply.code(403).type("text/plain").send("Forbidden origin");
      }
      return rejectContentType(request, reply);
    }
    if (needsOriginCheck(request) && !isAllowedOrigin(allowList, request.headers.origin)) {
      return void reply.code(403).type("text/plain").send("Forbidden origin");
    }
    const { token } = request.query as { token?: unknown };
    if (request.method === "GET" && !isApiPath(request) && session.isValidToken(token)) {
      return void reply
        .setCookie(session.cookieName, token as string, { httpOnly: true, sameSite: "strict", path: "/" })
        .header("cache-control", "no-store")
        .type("text/html; charset=utf-8")
        .send(SESSION_START_PAGE);
    }
    if (!session.isValidToken(request.cookies[session.cookieName])) {
      return void sendUnauthenticated(request, reply);
    }
    rejectContentType(request, reply);
  };
}
