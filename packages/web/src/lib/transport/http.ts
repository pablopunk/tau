import {
  AppError,
  type ErrorCode,
  fillPath,
  isErrorBody,
  type JsonRouteName,
  type RouteDef,
  routes,
} from "@tau/protocol";
import { Value } from "typebox/value";
import type { RequestOptions, RouteRequest, RouteResponse, Transport } from "./types";
import { createWebSocketTransport, openWebSocketStream } from "./websocket";

type RequestInput = {
  params?: Record<string, string>;
  query?: Record<string, string | undefined>;
  body?: unknown;
};

function urlFor(route: RouteDef, input: RequestInput, prefix: string): string {
  const entries = Object.entries(input.query ?? {}).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  const search = new URLSearchParams(entries).toString();
  return prefix + fillPath(route.path, input.params) + (search ? `?${search}` : "");
}

function assertBody(route: RouteDef, body: unknown): void {
  if (route.body && !Value.Check(route.body, body))
    throw new AppError("invalid_request", "The request is invalid");
}

function assertResponse(route: RouteDef, json: unknown): void {
  if (route.response && !Value.Check(route.response, json)) {
    throw new AppError("internal", "The server sent an unexpected response");
  }
}

function codeForStatus(status: number): ErrorCode {
  return status === 401 || status === 403 ? "unauthorized" : "internal";
}

async function failureFrom(response: Response): Promise<AppError> {
  const json: unknown = await response.json().catch(() => undefined);
  if (isErrorBody(json)) return new AppError(json.error.code, json.error.message);
  return new AppError(codeForStatus(response.status), `Request failed (${response.status})`);
}

function init(route: RouteDef, body: unknown): RequestInit {
  return {
    method: route.method,
    credentials: "same-origin",
    ...(route.body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  };
}

async function send(
  route: RouteDef,
  input: RequestInput,
  prefix: string,
  options?: RequestOptions,
): Promise<unknown> {
  assertBody(route, input.body);
  let response: Response;
  try {
    response = await fetch(urlFor(route, input, prefix), {
      ...init(route, input.body),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  } catch {
    options?.signal?.throwIfAborted();
    throw new AppError("internal", "Could not reach the server");
  }
  if (!response.ok) throw await failureFrom(response);
  if (route.status === 204) return undefined;
  const json: unknown = await response.json();
  assertResponse(route, json);
  return json;
}

export interface HttpTransportOptions {
  /** Added in front of every request, live and stream URL: `/api/n/<nodeId>` on the hub. Default: none (this node). */
  readonly prefix?: string;
}

export function createHttpTransport({ prefix = "" }: HttpTransportOptions = {}): Transport {
  return {
    async request<N extends JsonRouteName>(name: N, input: RouteRequest<N>, options?: RequestOptions) {
      return (await send(routes[name], input as RequestInput, prefix, options)) as RouteResponse<N>;
    },
    live: createWebSocketTransport(prefix),
    openStream: (path, handlers) => openWebSocketStream(path, handlers, prefix),
  };
}
