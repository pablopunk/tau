import { connect } from "node:net";
import { LIVE_PATH, type RouteName, routes } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { makeStaticDir, TOKEN } from "../testing/harness";
import {
  startTunneledServer,
  TUNNEL_HOSTNAME,
  type TunneledServer,
  type TunnelRequest,
} from "../testing/tunnel-harness";

let ctx: TunneledServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const ORIGIN = `https://${TUNNEL_HOSTNAME}`;
const JSON_HEADERS = { "content-type": "application/json", origin: ORIGIN };

describe("tagged socket: the master token is refused", () => {
  it("refuses a forged loopback Host even with the master token", async () => {
    ctx = await startTunneledServer();
    const host = `127.0.0.1:${ctx.server.port}`;
    const variants: Array<Record<string, string>> = [
      { authorization: `Bearer ${TOKEN}` },
      { cookie: ctx.cookie },
      { authorization: `Bearer ${TOKEN}`, origin: ctx.server.origin },
    ];
    for (const headers of variants) {
      const response = await ctx.tunnel({ path: "/api/settings", host, headers });
      expect(response.status, JSON.stringify(headers)).toBe(403);
    }
  });

  it("answers 401 to the master Bearer, the master cookie and ?token= on the tunnel Host", async () => {
    ctx = await startTunneledServer();
    const requests: TunnelRequest[] = [
      { path: "/api/settings", headers: { authorization: `Bearer ${TOKEN}` } },
      { path: "/api/settings", headers: { cookie: ctx.cookie } },
      { path: `/?token=${TOKEN}`, headers: {} },
      { path: `/api/settings?token=${TOKEN}`, headers: {} },
    ];
    for (const request of requests) {
      const response = await ctx.tunnel(request);
      expect(response.status, request.path).toBe(401);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("refuses the master Bearer on a WebSocket upgrade", async () => {
    ctx = await startTunneledServer();
    const socket = new WebSocket(`ws://${TUNNEL_HOSTNAME}${LIVE_PATH}`, {
      createConnection: () => ctx.tunnelSocket(),
      headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
    });
    const status = await new Promise<number>((resolve) => {
      socket.on("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.on("error", () => undefined);
    });
    expect(status).toBe(401);
  });
});

describe("tagged socket: a device cookie is accepted", () => {
  it("serves the API with a linked device's cookie", async () => {
    ctx = await startTunneledServer();
    const { cookie } = await ctx.linkDevice();
    const response = await ctx.tunnel({ path: "/api/settings", headers: { cookie } });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toHaveProperty("projectsFolder");
  });

  it("opens /live with a device cookie and the tunnel Origin, and closes it on revoke", async () => {
    ctx = await startTunneledServer();
    const { cookie, deviceId } = await ctx.linkDevice();
    const socket = new WebSocket(`ws://${TUNNEL_HOSTNAME}${LIVE_PATH}`, {
      createConnection: () => ctx.tunnelSocket(),
      headers: { cookie, origin: ORIGIN },
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    const revoke = await ctx.request({ method: "DELETE", url: `/api/access/devices/${deviceId}` });
    expect(revoke.statusCode).toBe(204);
    expect(await closed).toBe(1008);
  });

  it("rejects a revoked device's cookie", async () => {
    ctx = await startTunneledServer();
    const { cookie, deviceId } = await ctx.linkDevice();
    await ctx.core.access.revokeDevice(deviceId);
    expect((await ctx.tunnel({ path: "/api/settings", headers: { cookie } })).status).toBe(401);
  });

  it("also works on the loopback listener", async () => {
    ctx = await startTunneledServer();
    const { cookie } = await ctx.linkDevice();
    const response = await ctx.request({ url: "/api/settings", headers: { cookie } });
    expect(response.statusCode).toBe(200);
  });

  it("lists devices with `current` for the calling device", async () => {
    ctx = await startTunneledServer();
    const { cookie, deviceId } = await ctx.linkDevice();
    const response = await ctx.tunnel({ path: "/api/access/devices", headers: { cookie } });
    const devices = JSON.parse(response.body) as Array<{ id: string; current: boolean }>;
    expect(devices.find((device) => device.id === deviceId)?.current).toBe(true);
  });
});

describe("tagged socket: forged Host and Origin are refused", () => {
  it("refuses other Hosts, the Host with a port and a missing Host name", async () => {
    ctx = await startTunneledServer();
    const { cookie } = await ctx.linkDevice();
    for (const host of ["evil.example", `${TUNNEL_HOSTNAME}:443`, `${TUNNEL_HOSTNAME}:80`, "localhost", ""]) {
      const response = await ctx.tunnel({ path: "/api/settings", host, headers: { cookie } });
      expect(response.status, host).toBe(403);
    }
  });

  it("refuses a socket whose SNI is not the tunnel hostname", async () => {
    ctx = await startTunneledServer();
    const response = await ctx.tunnel({ path: "/api/health", sni: "evil.example" });
    expect(response.status).toBe(0);
  });

  it("refuses writes and sockets with a foreign, loopback or missing Origin", async () => {
    ctx = await startTunneledServer();
    const { cookie } = await ctx.linkDevice();
    for (const origin of [
      "https://evil.example",
      `http://127.0.0.1:${ctx.server.port}`,
      `http://${TUNNEL_HOSTNAME}`,
      "",
    ]) {
      const headers = { cookie, "content-type": "application/json", origin };
      const response = await ctx.tunnel({ method: "POST", path: "/api/pair", body: "{}", headers });
      expect(response.status, origin).toBe(403);
    }
    const missing = await ctx.tunnel({
      method: "POST",
      path: "/api/pair",
      body: "{}",
      headers: { cookie, "content-type": "application/json" },
    });
    expect(missing.status).toBe(403);
  });

  it("refuses a GET that carries a foreign Origin", async () => {
    ctx = await startTunneledServer();
    const { cookie } = await ctx.linkDevice();
    const response = await ctx.tunnel({
      path: "/api/settings",
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("refuses the tunnel Host on the loopback listener", async () => {
    ctx = await startTunneledServer();
    const { cookie } = await ctx.linkDevice();
    const response = await ctx.request({ url: "/api/settings", headers: { cookie, host: TUNNEL_HOSTNAME } });
    expect(response.statusCode).toBe(403);
  });
});

const PATH_FILLS = { id: "x", sid: "x", itemId: "x", toolUseId: "x", cid: "x", name: "x" } as const;
const filled = (path: string) =>
  path.replace(/:(\w+)/g, (_m, name: keyof typeof PATH_FILLS) => PATH_FILLS[name]);
const OPEN_ROUTES: readonly RouteName[] = ["getHealth", "redeemPairing"];

describe("tagged socket: the unauthenticated surface is exactly pair, redeem and health", () => {
  it("serves GET /pair with a locked-down CSP", async () => {
    ctx = await startTunneledServer();
    const response = await ctx.tunnel({ path: "/pair" });
    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("answers health with { ok: true } and nothing else", async () => {
    ctx = await startTunneledServer();
    const response = await ctx.tunnel({ path: "/api/health" });
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("redeem answers a generic 401 for a wrong code", async () => {
    ctx = await startTunneledServer();
    const response = await ctx.tunnel({
      method: "POST",
      path: "/api/pair/redeem",
      body: JSON.stringify({ code: "nope", deviceName: "x" }),
      headers: JSON_HEADERS,
    });
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body).error.message).toBe("That code did not work.");
  });

  it("answers 401 to every other route, with no cookie", async () => {
    ctx = await startTunneledServer();
    const closed = (Object.keys(routes) as RouteName[]).filter((name) => !OPEN_ROUTES.includes(name));
    for (const name of closed) {
      const { method, path } = routes[name];
      const response = await ctx.tunnel({
        method,
        path: filled(path),
        body: method === "GET" ? undefined : "{}",
        headers: JSON_HEADERS,
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    for (const path of [
      "/",
      "/index.html",
      "/p/1/c/2",
      LIVE_PATH,
      "/api/nope",
      "/pair/extra",
      "/assets/app.js",
    ]) {
      expect((await ctx.tunnel({ path })).status, path).toBe(401);
    }
  });

  it("answers 401 for /assets/* and the app shell, with a static dir", async () => {
    ctx = await startTunneledServer({ staticDir: makeStaticDir() });
    for (const path of ["/app.js", "/assets/app.js", "/", "/p/1/c/2"]) {
      expect((await ctx.tunnel({ path, headers: { accept: "text/html" } })).status, path).toBe(401);
    }
  });

  it("serves /pair on the loopback listener too, and nothing else without a session", async () => {
    ctx = await startTunneledServer();
    const bare = { host: `127.0.0.1:${ctx.server.port}` };
    expect((await ctx.server.app.inject({ url: "/pair", headers: bare })).statusCode).toBe(200);
    expect((await ctx.server.app.inject({ url: "/api/health", headers: bare })).statusCode).toBe(200);
    expect((await ctx.server.app.inject({ url: "/api/settings", headers: bare })).statusCode).toBe(401);
  });
});

describe("redeem", () => {
  const redeem = (code: string, headers: Record<string, string> = JSON_HEADERS, contentType = true) =>
    ctx.tunnel({
      method: "POST",
      path: "/api/pair/redeem",
      body: JSON.stringify({ code, deviceName: "Safari on iPhone" }),
      headers: contentType ? headers : { origin: ORIGIN, "content-type": "text/plain" },
    });

  it("sets a Secure, HttpOnly, SameSite=Strict device cookie on a tagged socket and burns the code", async () => {
    ctx = await startTunneledServer();
    const minted = await ctx.core.access.mintPairing({ kind: "device" });
    const response = await redeem(minted.code);
    expect(response.status).toBe(200);
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toMatch(/^tau_device=[0-9a-f]{64}/);
    for (const part of ["HttpOnly", "SameSite=Strict", "Secure", "Path=/"]) expect(cookie).toContain(part);
    expect(JSON.parse(response.body).secret).toBeUndefined();
    expect((await redeem(minted.code)).status).toBe(401);
    const session = cookie.split(";")[0] ?? "";
    expect((await ctx.tunnel({ path: "/api/settings", headers: { cookie: session } })).status).toBe(200);
  });

  it("needs JSON and the tunnel Origin", async () => {
    ctx = await startTunneledServer();
    const minted = await ctx.core.access.mintPairing({ kind: "device" });
    expect((await redeem(minted.code, { "content-type": "application/json" })).status).toBe(403);
    expect((await redeem(minted.code, JSON_HEADERS, false)).status).toBe(400);
    expect((await redeem(minted.code)).status).toBe(200);
  });

  it("returns a machine secret in the body, with no cookie", async () => {
    ctx = await startTunneledServer();
    const minted = await ctx.core.access.mintPairing({ kind: "machine" });
    const response = await redeem(minted.code);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(JSON.parse(response.body).secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("locks a peer after five failures, per PROXY peer address", async () => {
    ctx = await startTunneledServer();
    const minted = await ctx.core.access.mintPairing({ kind: "device" });
    const attempt = (code: string, peer: string) =>
      ctx.tunnel({
        method: "POST",
        path: "/api/pair/redeem",
        body: JSON.stringify({ code, deviceName: "x" }),
        headers: JSON_HEADERS,
        peer,
      });
    for (let index = 0; index < 5; index++) await attempt("nope", "198.51.100.9");
    expect((await attempt(minted.code, "198.51.100.9")).status).toBe(401);
    expect((await attempt(minted.code, "198.51.100.10")).status).toBe(200);
  });

  it("sets a cookie without Secure on the loopback listener", async () => {
    ctx = await startTunneledServer();
    const minted = await ctx.core.access.mintPairing({ kind: "device" });
    const response = await ctx.server.app.inject({
      method: "POST",
      url: "/api/pair/redeem",
      payload: { code: minted.code, deviceName: "Laptop" },
      headers: { host: `127.0.0.1:${ctx.server.port}`, origin: ctx.server.origin },
    });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers["set-cookie"])).not.toContain("Secure");
  });
});

describe("tunnel listener: destroy rules", () => {
  const closedWithout = (write: (socket: ReturnType<typeof connect>) => void) =>
    new Promise<string>((resolve) => {
      const socket = connect(ctx.tunnelPort, "127.0.0.1");
      let received = "";
      socket.on("data", (chunk) => {
        received += chunk.toString();
      });
      socket.on("close", () => resolve(received));
      socket.on("error", () => undefined);
      write(socket);
    });

  it("destroys a plain HTTP request with no PROXY header, and never answers it", async () => {
    ctx = await startTunneledServer();
    const received = await closedWithout((socket) =>
      socket.write(`GET /api/health HTTP/1.1\r\nHost: ${TUNNEL_HOSTNAME}\r\n\r\n`),
    );
    expect(received).toBe("");
  });

  it("destroys a malformed header", async () => {
    ctx = await startTunneledServer();
    const bad = Buffer.concat([
      Buffer.from("0d0a0d0a000d0a515549540a", "hex"),
      Buffer.from([0x25, 0x11, 0, 0]),
    ]);
    expect(await closedWithout((socket) => socket.write(bad))).toBe("");
  });

  it("never lets a loopback client claim to be tunneled by a header", async () => {
    ctx = await startTunneledServer();
    const { cookie } = await ctx.linkDevice();
    const response = await ctx.server.app.inject({
      url: "/api/settings",
      headers: { cookie, host: TUNNEL_HOSTNAME, "x-forwarded-for": "1.2.3.4", forwarded: "for=1.2.3.4" },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("machine branch (Stage 2)", () => {
  it.todo("accepts a machine Bearer only on GET /api/machines/link with an Upgrade header");
  it.todo("checks the per-peer rate limit before the hash lookup on the link route");
  it.todo("sets request.deviceId to the machine's device id, so revoke closes the link socket");
  it.todo("answers 401 to a machine Bearer on /api/settings, /api/live and the terminal stream");
  it.todo("answers 401 to a device cookie on the link route");
  it.todo("answers 401 to a machine secret presented as a device cookie");
  it.todo("refuses a master token on a tagged link request");
});
