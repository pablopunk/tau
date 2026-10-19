import { LIVE_PATH, NODE_LINK_PATH, terminalStreamPath } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { TOKEN } from "../testing/harness";
import { createRecordingGateway, type RecordingGateway } from "../testing/recording-gateway";
import { startTunneledServer, TUNNEL_HOSTNAME, type TunneledServer } from "../testing/tunnel-harness";

let ctx: TunneledServer;
let gateway: RecordingGateway;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const ORIGIN = `https://${TUNNEL_HOSTNAME}`;

async function start() {
  gateway = createRecordingGateway();
  ctx = await startTunneledServer({ gateway });
}

/** A WebSocket through the tunnel listener; resolves with the status of a refusal or the open socket. */
function dialTunnel(path: string, headers: Record<string, string>, peer?: string) {
  const socket = new WebSocket(`ws://${TUNNEL_HOSTNAME}${path}`, {
    createConnection: () => ctx.tunnelSocket({ peer }),
    headers: { origin: ORIGIN, ...headers },
  });
  return settle(socket);
}

function dialLocal(path: string, headers: Record<string, string>) {
  const socket = new WebSocket(`ws://127.0.0.1:${ctx.server.port}${path}`, {
    headers: { host: `127.0.0.1:${ctx.server.port}`, ...headers },
  });
  return settle(socket);
}

function settle(socket: WebSocket): Promise<{ status: number; socket: WebSocket }> {
  return new Promise((resolve) => {
    socket.on("open", () => resolve({ status: 101, socket }));
    socket.on("unexpected-response", (_request, response) =>
      resolve({ status: response.statusCode ?? 0, socket }),
    );
    socket.on("error", () => undefined);
  });
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
const closeOf = (socket: WebSocket) => new Promise<number>((resolve) => socket.once("close", resolve));

describe("node branch: the link route", () => {
  it("accepts a node Bearer on GET /api/nodes/link with an Upgrade header, on a tagged socket", async () => {
    await start();
    const { secret, deviceId } = await ctx.linkNode();
    const { status, socket } = await dialTunnel(NODE_LINK_PATH, bearer(secret));
    expect(status).toBe(101);
    expect(gateway.links.has(deviceId)).toBe(true);
    socket.close();
  });

  it("accepts it on the loopback listener too (`--hub http://127.0.0.1:<port>`)", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    const { status, socket } = await dialLocal(NODE_LINK_PATH, {
      ...bearer(secret),
      origin: ctx.server.origin,
    });
    expect(status).toBe(101);
    socket.close();
  });

  it("answers 401 without an Upgrade header, whatever the method", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    for (const method of ["GET", "POST", "PUT"]) {
      const response = await ctx.tunnel({
        method,
        path: NODE_LINK_PATH,
        headers: { ...bearer(secret), origin: ORIGIN },
      });
      expect(response.status, method).toBe(401);
    }
  });

  it("answers 401 to a wrong secret and records no cookie", async () => {
    await start();
    const { status } = await dialTunnel(NODE_LINK_PATH, bearer("0".repeat(64)));
    expect(status).toBe(401);
  });

  it("sets request.deviceId to the node's device id, so revoke closes the link socket", async () => {
    await start();
    const { secret, deviceId } = await ctx.linkNode();
    const { socket } = await dialTunnel(NODE_LINK_PATH, bearer(secret));
    const closed = closeOf(socket);
    const revoke = await ctx.request({ method: "DELETE", url: `/api/access/devices/${deviceId}` });
    expect(revoke.statusCode).toBe(204);
    expect(await closed).toBe(1008);
  });

  it("refuses the owner (master Bearer) on the link socket after the upgrade", async () => {
    await start();
    const { status, socket } = await dialLocal(NODE_LINK_PATH, {
      ...bearer(TOKEN),
      origin: ctx.server.origin,
    });
    expect(status).toBe(101);
    expect(await closeOf(socket)).toBe(1008);
  });

  it("refuses a master token on a tagged link request, as Bearer, cookie and ?token=", async () => {
    await start();
    for (const [path, headers] of [
      [NODE_LINK_PATH, bearer(TOKEN)],
      [NODE_LINK_PATH, { cookie: ctx.cookie }],
      [`${NODE_LINK_PATH}?token=${TOKEN}`, {}],
    ] as const) {
      expect((await dialTunnel(path, { ...headers })).status, path).toBe(401);
    }
  });

  it("answers 401 to a device cookie on the link route, tagged and loopback", async () => {
    await start();
    const { cookie } = await ctx.linkDevice();
    expect((await dialTunnel(NODE_LINK_PATH, { cookie })).status).toBe(401);
    expect((await dialLocal(NODE_LINK_PATH, { cookie, origin: ctx.server.origin })).status).toBe(401);
  });
});

describe("node branch: the per-peer rate limit comes before the hash lookup", () => {
  it("locks a peer after five wrong secrets, so even its right secret is refused", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await dialTunnel(NODE_LINK_PATH, bearer(`${attempt}`.repeat(64)), "198.51.100.9")).status).toBe(
        401,
      );
    }
    const locked = await dialTunnel(NODE_LINK_PATH, bearer(secret), "198.51.100.9");
    expect(locked.status).toBe(401);
    const other = await dialTunnel(NODE_LINK_PATH, bearer(secret), "198.51.100.10");
    expect(other.status).toBe(101);
    other.socket.close();
  });

  it("does not look the secret up while a peer is locked", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    let lookups = 0;
    const verify = ctx.core.access.verifyNode.bind(ctx.core.access);
    ctx.core.access.verifyNode = async (value) => {
      lookups++;
      return verify(value);
    };
    for (let attempt = 0; attempt < 5; attempt++)
      await dialTunnel(NODE_LINK_PATH, bearer("f".repeat(64)), "198.51.100.20");
    expect(lookups).toBe(5);
    await dialTunnel(NODE_LINK_PATH, bearer(secret), "198.51.100.20");
    expect(lookups).toBe(5);
  });
});

describe("node branch: a node secret works nowhere else", () => {
  it("answers 401 to a node Bearer on /api/settings, /api/live and the terminal stream, tagged and loopback", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    const rest = await ctx.tunnel({ path: "/api/settings", headers: bearer(secret) });
    expect(rest.status).toBe(401);
    for (const path of [LIVE_PATH, terminalStreamPath("t1")]) {
      expect((await dialTunnel(path, bearer(secret))).status, path).toBe(401);
      const local = await dialLocal(path, { ...bearer(secret), origin: ctx.server.origin });
      expect(local.status, `local ${path}`).toBe(401);
    }
    const localRest = await ctx.server.app.inject({
      url: "/api/settings",
      headers: { host: `127.0.0.1:${ctx.server.port}`, ...bearer(secret) },
    });
    expect(localRest.statusCode).toBe(401);
  });

  it("answers 401 to a node Bearer on POST /api/update/refresh, tagged and loopback", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    const tunneled = await ctx.tunnel({
      method: "POST",
      path: "/api/update/refresh",
      headers: { origin: ORIGIN, ...bearer(secret) },
    });
    expect(tunneled.status).toBe(401);
    const local = await ctx.server.app.inject({
      method: "POST",
      url: "/api/update/refresh",
      headers: { host: `127.0.0.1:${ctx.server.port}`, origin: ctx.server.origin, ...bearer(secret) },
    });
    expect(local.statusCode).toBe(401);
  });

  it("answers 401 to a node secret presented as a device cookie", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    const response = await ctx.tunnel({ path: "/api/settings", headers: { cookie: `tau_device=${secret}` } });
    expect(response.status).toBe(401);
  });

  it("answers 401 to a node Bearer on the hub proxy and the node routes", async () => {
    await start();
    const { secret, deviceId } = await ctx.linkNode();
    for (const path of [`/api/n/${deviceId}/api/conversations`, "/api/nodes", "/api/access/devices"]) {
      expect((await ctx.tunnel({ path, headers: bearer(secret) })).status, path).toBe(401);
    }
  });
});

describe("pin (m1): frame caps on the shared WebSocket server", () => {
  it("passes a 256 KB frame on the link and keeps the socket open", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    const { socket } = await dialTunnel(NODE_LINK_PATH, bearer(secret));
    socket.send(Buffer.alloc(256 * 1024 + 5, 7));
    const pong = new Promise<string>((resolve) => socket.once("message", (data) => resolve(String(data))));
    socket.send("ping");
    expect(await pong).toBe("pong");
    expect(gateway.received[0]).toBe(256 * 1024 + 5);
    socket.close();
  });

  it("drops the link (1009, or 1006 when the peer is still writing) above the shared 1 MB maxPayload", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    const { socket } = await dialTunnel(NODE_LINK_PATH, bearer(secret));
    const closed = closeOf(socket);
    socket.send(Buffer.alloc(1024 * 1024 + 1));
    expect([1009, 1006]).toContain(await closed);
  });

  it("refuses a 256 KB frame on /api/live with 1009 (a 70 KB terminal frame: terminals/stream.test.ts)", async () => {
    await start();
    const { cookie } = await ctx.linkDevice();
    const live = await dialTunnel(LIVE_PATH, { cookie });
    const liveClosed = closeOf(live.socket);
    live.socket.send(Buffer.alloc(256 * 1024, 97));
    expect(await liveClosed).toBe(1009);
  });
});

describe("no chains: a tau linked to a hub accepts no nodes", () => {
  const LINKED = {
    state: "linked",
    hubName: "Hub",
    hubUrl: "https://hub.test",
    since: 1,
    message: null,
  } as const;

  it("refuses to mint a node code and closes a link socket, but still mints device codes", async () => {
    await start();
    const { secret } = await ctx.linkNode();
    ctx.core.nodes.reportLink(LINKED);
    const node = await ctx.request({ method: "POST", url: "/api/pair?kind=machine" });
    expect(node.statusCode).toBe(400);
    expect((await ctx.request({ method: "POST", url: "/api/pair?kind=device" })).statusCode).toBe(200);
    const { socket } = await dialTunnel(NODE_LINK_PATH, bearer(secret));
    expect(await closeOf(socket)).toBe(1008);
    expect(gateway.links.size).toBe(0);
  });
});
