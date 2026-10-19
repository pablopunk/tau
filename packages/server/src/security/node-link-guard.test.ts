import { request as httpRequest } from "node:http";
import { NODE_LINK_LEGACY_PATH, NODE_LINK_PATH } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { filterProxyPath } from "../nodes/path-filter";
import { TOKEN } from "../testing/harness";
import { startTunneledServer, TUNNEL_HOSTNAME, type TunneledServer } from "../testing/tunnel-harness";

/**
 * MVP13 Step 1 security tests, written BEFORE the guard change: the 0.1.x alias, the exact paths where a node
 * secret is looked at, and the loopback contract the responder of a symmetric link relies on.
 */
let ctx: TunneledServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const ORIGIN = `https://${TUNNEL_HOSTNAME}`;
const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
const closeOf = (socket: WebSocket) => new Promise<number>((resolve) => socket.once("close", resolve));

async function start() {
  ctx = await startTunneledServer();
}

function settle(socket: WebSocket): Promise<{ status: number; socket: WebSocket }> {
  return new Promise((resolve) => {
    socket.on("open", () => resolve({ status: 101, socket }));
    socket.on("unexpected-response", (_req, response) =>
      resolve({ status: response.statusCode ?? 0, socket }),
    );
    socket.on("error", () => undefined);
  });
}
const dialTunnel = (path: string, headers: Record<string, string>) =>
  settle(
    new WebSocket(`ws://${TUNNEL_HOSTNAME}${path}`, {
      createConnection: () => ctx.tunnelSocket(),
      headers: { origin: ORIGIN, ...headers },
    }),
  );
const dialLocal = (path: string, headers: Record<string, string>) =>
  settle(
    new WebSocket(`ws://127.0.0.1:${ctx.server.port}${path}`, {
      headers: { host: `127.0.0.1:${ctx.server.port}`, origin: ctx.server.origin, ...headers },
    }),
  );

describe("the 0.1.x alias /api/machines/link", () => {
  it("accepts a node secret with an Upgrade and closes with 4001 (update required), tagged and loopback", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    const tunneled = await dialTunnel(NODE_LINK_LEGACY_PATH, bearer(secret));
    expect(tunneled.status).toBe(101);
    expect(await closeOf(tunneled.socket)).toBe(4001);
    const local = await dialLocal(NODE_LINK_LEGACY_PATH, bearer(secret));
    expect(local.status).toBe(101);
    expect(await closeOf(local.socket)).toBe(4001);
  });

  it("never answers 401 to a valid node secret on the alias: a 0.1.x dialler would show 'refused'", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    const { status, socket } = await dialLocal(NODE_LINK_LEGACY_PATH, bearer(secret));
    expect([401, 403]).not.toContain(status);
    socket.close();
  });

  it("still answers 401 to a wrong secret, a device cookie and a master token on the alias", async () => {
    await start();
    const { cookie } = await ctx.linkDevice();
    expect((await dialTunnel(NODE_LINK_LEGACY_PATH, bearer("0".repeat(64)))).status).toBe(401);
    expect((await dialTunnel(NODE_LINK_LEGACY_PATH, { cookie })).status).toBe(401);
    expect((await dialTunnel(NODE_LINK_LEGACY_PATH, bearer(TOKEN))).status).toBe(401);
  });

  it("answers 401 without an Upgrade header, whatever the method", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    for (const method of ["GET", "POST"]) {
      const response = await ctx.tunnel({
        method,
        path: NODE_LINK_LEGACY_PATH,
        headers: { ...bearer(secret), origin: ORIGIN },
      });
      expect(response.status, method).toBe(401);
    }
  });

  it("shares the per-peer rate limit with the real link path", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await dialLocal(NODE_LINK_LEGACY_PATH, bearer(`${attempt}`.repeat(64)))).status).toBe(401);
    }
    expect((await dialLocal(NODE_LINK_PATH, bearer(secret))).status).toBe(401);
  });
});

describe("a node secret is looked at on exactly two paths", () => {
  const NOT_THE_LINK = [
    `${NODE_LINK_PATH}/`,
    `${NODE_LINK_PATH}/extra`,
    `${NODE_LINK_LEGACY_PATH}/`,
    `${NODE_LINK_LEGACY_PATH}/extra`,
    "/api/Nodes/link",
    "/api/nodes/links",
    "/api/nodes/link%2f",
    `/api/n/abc${NODE_LINK_PATH}`,
    "/api/nodes",
    "/api/access/devices",
  ];

  it("answers 401 to a valid node secret on every other path, as an upgrade and as a plain request", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    for (const path of NOT_THE_LINK) {
      expect((await dialTunnel(path, bearer(secret))).status, `ws ${path}`).toBe(401);
      expect((await dialLocal(path, bearer(secret))).status, `local ws ${path}`).toBe(401);
      const plain = await ctx.tunnel({ path, headers: bearer(secret) });
      expect(plain.status, `http ${path}`).toBe(401);
    }
  });

  it("accepts a query string on the link path, because the path is what counts", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    const { status, socket } = await dialLocal(`${NODE_LINK_PATH}?v=2`, bearer(secret));
    expect(status).toBe(101);
    socket.close();
  });
});

describe("the responder's loopback contract (what a symmetric link calls on its own server)", () => {
  const call = (port: number, path: string, headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path, headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });

  it("works at the BOUND port with the server's own token, as an untagged loopback socket", async () => {
    await start();
    const port = ctx.server.port;
    expect(port).toBeGreaterThan(0);
    expect(await call(port, "/api/settings", { host: `127.0.0.1:${port}`, ...bearer(TOKEN) })).toBe(200);
    const sent = await ctx.server.app.inject({
      url: "/api/settings",
      headers: { host: `127.0.0.1:${port}`, ...bearer(TOKEN) },
    });
    expect(sent.statusCode).toBe(200);
  });

  it("is refused with the configured port 0 as the Host (only the bound port is allowed)", async () => {
    await start();
    const port = ctx.server.port;
    expect(await call(port, "/api/settings", { host: "127.0.0.1:0", ...bearer(TOKEN) })).toBe(403);
  });

  it("is refused when the call carries a foreign Origin: the responder never forwards Origin", async () => {
    await start();
    const port = ctx.server.port;
    expect(
      await call(port, "/api/settings", { host: `127.0.0.1:${port}`, origin: ORIGIN, ...bearer(TOKEN) }),
    ).toBe(403);
  });

  it("is refused with a node secret: the loopback call uses the server's token, never a peer secret", async () => {
    await start();
    const port = ctx.server.port;
    const { secret } = await ctx.linkNode();
    expect(await call(port, "/api/settings", { host: `127.0.0.1:${port}`, ...bearer(secret) })).toBe(401);
  });

  it("the responder-side path filter refuses /api/access, /api/nodes/**, /api/n/** and the link paths", () => {
    const denied = [
      "/api/access/devices",
      "/api/access/devices/abc",
      "/api/nodes",
      "/api/nodes/abc/summary",
      "/api/nodes/self",
      "/api/nodes/identity/reset",
      "/api/n/abc/api/threads",
      "/api/remote",
      "/api/pair",
      "/api/pair/redeem",
      "/api/update",
      "/api/health",
      NODE_LINK_PATH,
      NODE_LINK_LEGACY_PATH,
    ];
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      for (const path of denied) {
        expect(filterProxyPath(method, path).allowed, `${method} ${path}`).toBe(false);
      }
    }
    expect(filterProxyPath("GET", "/api/settings").allowed).toBe(true);
    expect(filterProxyPath("GET", "/api/live").allowed).toBe(true);
  });
});
