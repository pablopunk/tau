import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readRunningInstance } from "@tau/core";
import { fillPath, isErrorBody, type JsonRouteName, routes } from "@tau/protocol";
import { CliExit, failure, NOT_RUNNING_MESSAGE } from "./cli-exit";
import type { CommandEnv } from "./command-env";
import { targetPath } from "./node-target";

export interface Server {
  readonly nodeId?: string;
  /** `http://127.0.0.1:<port>`, no token. */
  readonly url: string;
  readonly token: string;
}

export interface RouteRequest {
  readonly params?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly body?: unknown;
}

const URL_POLL_MS = 100;

async function waitForLockUrl(home: string, env: CommandEnv): Promise<string> {
  const deadline = env.now() + env.startupWaitMs;
  for (;;) {
    const info = await readRunningInstance(home);
    if (!info) throw failure(NOT_RUNNING_MESSAGE);
    if (info.url) return info.url;
    if (env.now() >= deadline) throw failure("tau is starting but has not published its URL yet.");
    await env.sleep(URL_POLL_MS);
  }
}

async function readToken(home: string): Promise<string> {
  try {
    return (await readFile(join(home, "token"), "utf8")).trim();
  } catch {
    throw failure(NOT_RUNNING_MESSAGE);
  }
}

/** The lock gives the URL and `<home>/token` the secret. Retries while a live server has no URL yet. */
export async function discoverServer(env: CommandEnv): Promise<Server> {
  if (env.server) return env.server;
  const url = await waitForLockUrl(env.home, env);
  return {
    url,
    token: await readToken(env.home),
    ...(env.nodeId === undefined ? {} : { nodeId: env.nodeId }),
  };
}

const queryString = (query: Record<string, string> | undefined): string => {
  const entries = Object.entries(query ?? {});
  return entries.length === 0 ? "" : `?${new URLSearchParams(entries).toString()}`;
};

async function errorMessageOf(response: Response): Promise<CliExit> {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (isErrorBody(parsed))
      return new CliExit(1, `${parsed.error.code}: ${parsed.error.message}`, parsed.error.code, "protocol");
  } catch {
    // not JSON: fall through to the status line
  }
  return failure(`HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
}

async function send(
  server: Server,
  name: JsonRouteName,
  request: RouteRequest,
  env: CommandEnv,
  signal: AbortSignal,
) {
  const route = routes[name];
  const target = `${server.url}${targetPath(server, fillPath(route.path, request.params))}${queryString(request.query)}`;
  const hasBody = request.body !== undefined;
  try {
    return await env.fetch(target, {
      method: route.method,
      signal,
      headers: {
        authorization: `Bearer ${server.token}`,
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(request.body) : undefined,
    });
  } catch {
    throw failure(
      env.machine
        ? "Transport failed; the target operation's effects are unknown. Reconcile before retrying."
        : NOT_RUNNING_MESSAGE,
    );
  }
}

/** Calls one route. Returns the parsed JSON, or `undefined` for an empty answer. An `AppError` becomes a failure. */
export async function callRoute(
  server: Server,
  name: JsonRouteName,
  request: RouteRequest,
  env: CommandEnv,
): Promise<unknown> {
  const controller = new AbortController();
  const cancel = env.after(30_000, () => controller.abort());
  try {
    const response = await send(server, name, request, env, controller.signal);
    if (!response.ok) throw await errorMessageOf(response);
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  } finally {
    cancel();
  }
}
