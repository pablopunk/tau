import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Core } from "@tau/protocol";
import { createFakeCore, type FakeCoreOptions } from "@tau/testkit";
import type { LightMyRequestResponse } from "fastify";
import { createServer, type RunningServer } from "../create-server";
import type { MachineGateway } from "../machines/gateway";

export const TOKEN = "test-token-123";

export interface TestServer {
  readonly server: RunningServer;
  readonly core: Core;
  readonly cookie: string;
  /** Headers a same-origin browser tab would send. */
  readonly headers: Record<string, string>;
  request(options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
  }): Promise<LightMyRequestResponse>;
}

export function makeStaticDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tau-static-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>app</title><div id=root></div>");
  writeFileSync(join(dir, "app.js"), "console.log('app')");
  return dir;
}

export async function startTestServer(
  options: { core?: Core; fake?: FakeCoreOptions; staticDir?: string; gateway?: MachineGateway } = {},
): Promise<TestServer> {
  const core = options.core ?? createFakeCore({ configured: true, speed: 1000, ...options.fake });
  const server = await createServer({
    core,
    port: 0,
    token: TOKEN,
    staticDir: options.staticDir,
    gateway: options.gateway,
  });
  const cookie = `tau_${server.port}=${TOKEN}`;
  const headers = { host: `127.0.0.1:${server.port}`, origin: server.origin, cookie };
  return {
    server,
    core,
    cookie,
    headers,
    request: ({ method = "GET", url, payload, headers: extra }) =>
      server.app.inject({
        method,
        url,
        payload: payload as object | undefined,
        headers: { ...headers, ...extra },
      }),
  };
}
