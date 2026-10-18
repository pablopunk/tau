import { AppError } from "@tau/protocol";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  type AllowList,
  isAllowedLocalHost,
  isAllowedLocalOrigin,
  isTunnelHost,
  isTunnelOrigin,
} from "./allow-list";
import type { GuardContext } from "./guard-context";
import {
  bearerOf,
  isApiPath,
  isOpenSurface,
  needsOriginCheck,
  rejectApi,
  rejectContentType,
} from "./request-info";
import { SESSION_START_PAGE } from "./session-start-page";
import { UNAUTHORIZED_PAGE } from "./unauthorized-page";

export const DEVICE_COOKIE = "tau_device";
export const OWNER_DEVICE_ID = "owner";

export type { GuardContext } from "./guard-context";

function forbid(reply: FastifyReply, what: "host" | "origin") {
  return void reply.code(403).type("text/plain").send(`Forbidden ${what}`);
}

function sendUnauthenticated(request: FastifyRequest, reply: FastifyReply) {
  if (isApiPath(request)) {
    return rejectApi(reply, new AppError("unauthorized", "Open the URL printed in your terminal"));
  }
  return reply.code(401).type("text/html; charset=utf-8").send(UNAUTHORIZED_PAGE);
}

async function authenticateDevice(ctx: GuardContext, request: FastifyRequest): Promise<boolean> {
  const secret = request.cookies[DEVICE_COOKIE];
  const verified = secret ? await ctx.access.verifyDevice(secret) : undefined;
  if (!verified) return false;
  request.deviceId = verified.deviceId;
  ctx.access.touch(verified.deviceId);
  return true;
}

/** A tagged socket came through the tunnel: only the tunnel Host and Origin, only a device cookie. */
async function guardTunneled(ctx: GuardContext, request: FastifyRequest, reply: FastifyReply) {
  const list = ctx.hostnames();
  if (!isTunnelHost(list, request.headers.host)) return forbid(reply, "host");
  const { origin } = request.headers;
  const originOk = isTunnelOrigin(list, origin);
  if ((needsOriginCheck(request) && !originOk) || (origin !== undefined && !originOk)) {
    return forbid(reply, "origin");
  }
  if (isOpenSurface(request)) return rejectContentType(request, reply);
  if (!(await authenticateDevice(ctx, request))) return sendUnauthenticated(request, reply);
  rejectContentType(request, reply);
}

function hasForeignOrigin(list: AllowList, request: FastifyRequest): boolean {
  const { origin } = request.headers;
  return origin !== undefined && !isAllowedLocalOrigin(list, origin);
}

function startSession(ctx: GuardContext, reply: FastifyReply, token: string) {
  return void reply
    .setCookie(ctx.session.cookieName, token, { httpOnly: true, sameSite: "strict", path: "/" })
    .header("cache-control", "no-store")
    .type("text/html; charset=utf-8")
    .send(SESSION_START_PAGE);
}

/** An untagged socket is loopback: the master token works, and device cookies too. */
async function guardLocal(ctx: GuardContext, request: FastifyRequest, reply: FastifyReply) {
  const list = ctx.hostnames();
  if (!isAllowedLocalHost(list, request.headers.host)) return forbid(reply, "host");
  if (request.headers.authorization !== undefined) {
    if (!ctx.session.isValidToken(bearerOf(request))) return sendUnauthenticated(request, reply);
    if (hasForeignOrigin(list, request)) return forbid(reply, "origin");
    request.deviceId = OWNER_DEVICE_ID;
    return rejectContentType(request, reply);
  }
  if (needsOriginCheck(request) && !isAllowedLocalOrigin(list, request.headers.origin)) {
    return forbid(reply, "origin");
  }
  if (isOpenSurface(request)) return rejectContentType(request, reply);
  const { token } = request.query as { token?: unknown };
  if (request.method === "GET" && !isApiPath(request) && ctx.session.isValidToken(token)) {
    return startSession(ctx, reply, token as string);
  }
  if (ctx.session.isValidToken(request.cookies[ctx.session.cookieName])) {
    request.deviceId = OWNER_DEVICE_ID;
    return rejectContentType(request, reply);
  }
  if (!(await authenticateDevice(ctx, request))) return sendUnauthenticated(request, reply);
  rejectContentType(request, reply);
}

/** Runs before routing. Provenance is the socket (`ctx.tunnel`), never a header. */
export function createGuard(ctx: GuardContext) {
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (ctx.tunnel.tagOf(request.raw.socket)) return guardTunneled(ctx, request, reply);
    return guardLocal(ctx, request, reply);
  };
}
