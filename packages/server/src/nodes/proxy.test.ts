import { request as httpRequest } from "node:http";
import { ERROR_STATUS, LIVE_PATH, nodeApiPrefix, terminalStreamPath, UPLOAD_BODY_LIMIT } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startTestServer, type TestServer } from "../testing/harness";
import { createStubGateway } from "../testing/stub-gateway";
import { linkNodes, startNode, type TestNode, viaNode } from "../testing/two-nodes";
import type { GatewayRequest, NodeGateway } from "./gateway";

let ctx: TestServer;
afterEach(async () => {
  await ctx?.server.close();
  await ctx?.core.close();
});

function echoGateway(seen: GatewayRequest[], streams: WebSocket[] = []): NodeGateway {
  return {
    ...createStubGateway(),
    isOnline: () => true,
    async request(_id, request) {
      seen.push(request);
      return {
        status: 200,
        headers: { "Content-Type": "text/plain", "Set-Cookie": "tau_device=planted", "X-Evil": "1" },
        body: Buffer.from("from the node"),
      };
    },
    openStream: (_id, _request, socket) => void streams.push(socket as unknown as WebSocket),
  };
}

/** Sends the path exactly as given (inject() and fetch() normalise `%2e%2e` away before the server sees it). */
function rawGet(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: ctx.server.port, path, headers: ctx.headers },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const proxied = (path: string) => `${nodeApiPrefix("m1")}${path}`;

describe("hub proxy /api/n/<id>/**", () => {
  it("answers 403 for the denylist and 404 for unknown paths, before any gateway call", async () => {
    const seen: GatewayRequest[] = [];
    ctx = await startTestServer({ gateway: echoGateway(seen) });
    for (const path of ["/api/access/devices", "/api/remote", "/api/nodes", "/api/pair", "/api/health"]) {
      expect((await ctx.request({ url: proxied(path) })).statusCode, path).toBe(403);
    }
    for (const path of ["/api/projects/%2e%2e/settings", "/api/projects/a%2fb", "/api//conversations"]) {
      expect(await rawGet(proxied(path)), path).toBe(403);
    }
    expect((await ctx.request({ url: proxied("/api/nope") })).statusCode).toBe(404);
    expect((await ctx.request({ url: proxied("/assets/app.js") })).statusCode).toBe(404);
    expect(seen).toEqual([]);
  });

  it("forwards an allowed call with the label, drops set-cookie and unknown headers, never forwards credentials", async () => {
    const seen: GatewayRequest[] = [];
    ctx = await startTestServer({ gateway: echoGateway(seen) });
    const response = await ctx.request({ url: `${proxied("/api/conversations")}?projectId=p1` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("from the node");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["x-evil"]).toBeUndefined();
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(seen[0]).toMatchObject({
      method: "GET",
      path: "/api/conversations",
      query: "projectId=p1",
      via: "owner",
    });
    expect(JSON.stringify(seen[0])).not.toContain("cookie");
  });

  it("passes the raw body through without parsing it, and re-applies the per-route body limit", async () => {
    const seen: GatewayRequest[] = [];
    ctx = await startTestServer({ gateway: echoGateway(seen) });
    const text = "{not json at all";
    const raw = await ctx.request({
      method: "POST",
      url: proxied("/api/projects"),
      payload: text,
      headers: { "content-type": "application/json" },
    });
    expect(raw.statusCode).toBe(200);
    expect(seen[0]?.body?.toString()).toBe(text);
    const big = await ctx.request({
      method: "POST",
      url: proxied("/api/projects"),
      payload: "x".repeat(1024 * 1024 + 1),
      headers: { "content-type": "application/json" },
    });
    expect(big.statusCode).toBe(ERROR_STATUS.too_large);
  });

  it("accepts a 42 MB message body on the message route only", async () => {
    const seen: GatewayRequest[] = [];
    ctx = await startTestServer({ gateway: echoGateway(seen) });
    const ok = await ctx.request({
      method: "POST",
      url: proxied("/api/conversations/c1/messages"),
      payload: Buffer.alloc(42 * 1024 * 1024 - 1024, 97),
      headers: { "content-type": "application/json" },
    });
    expect(ok.statusCode).toBe(200);
    expect(seen[0]?.body?.length).toBe(42 * 1024 * 1024 - 1024);
  });

  it("answers not_found when the node is not linked (stub gateway)", async () => {
    ctx = await startTestServer();
    expect((await ctx.request({ url: proxied("/api/conversations") })).statusCode).toBe(404);
  });

  it("requires authentication like any API route", async () => {
    ctx = await startTestServer({ gateway: echoGateway([]) });
    const response = await ctx.server.app.inject({
      url: proxied("/api/conversations"),
      headers: { host: `127.0.0.1:${ctx.server.port}` },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("hub proxied sockets", () => {
  const open = (path: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${ctx.server.port}${path}`, { headers: ctx.headers });
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });
  const closeOf = (socket: WebSocket) => new Promise<number>((resolve) => socket.once("close", resolve));

  it("refuses frames above 64 KB with 1009 on the proxied /live and terminal stream, before the gateway sees them", async () => {
    const streams: WebSocket[] = [];
    ctx = await startTestServer({ gateway: echoGateway([], streams) });
    for (const path of [proxied(LIVE_PATH), proxied(terminalStreamPath("t1"))]) {
      const socket = await open(path);
      const closed = closeOf(socket);
      socket.send(Buffer.alloc(70 * 1024, 97));
      expect(await closed, path).toBe(1009);
    }
    expect(streams).toHaveLength(2);
  });

  it("registers proxied sockets so disconnecting the node closes them", async () => {
    ctx = await startTestServer({ gateway: echoGateway([]), fake: { nodes: true } });
    const [node] = await ctx.core.nodes.list();
    const id = node?.id ?? "";
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${ctx.server.port}${nodeApiPrefix(id)}${LIVE_PATH}`, {
        headers: ctx.headers,
      });
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
    const closed = closeOf(socket);
    expect((await ctx.request({ method: "DELETE", url: `/api/nodes/${id}` })).statusCode).toBe(204);
    expect(await closed).toBe(1008);
    expect(await ctx.core.nodes.list()).toHaveLength(1);
  });
});

describe("hub proxy owner-only upload route", () => {
  const uploadBody = (data: string) => JSON.stringify({ name: "notes.txt", mimeType: "text/plain", data });
  const tinyData = () => Buffer.from("hello").toString("base64");

  async function deviceHeaders(): Promise<Record<string, string>> {
    const minted = await ctx.core.access.mintPairing({ kind: "device" });
    const redeemed = await ctx.core.access.redeemPairing({
      code: minted.code,
      deviceName: "browser",
      peer: "test",
    });
    return { ...ctx.headers, cookie: `tau_device=${redeemed.secret}` };
  }

  it("rejects a non-owner upload with forbidden, before any gateway call", async () => {
    const seen: GatewayRequest[] = [];
    ctx = await startTestServer({ gateway: echoGateway(seen) });
    const response = await ctx.request({
      method: "POST",
      url: proxied("/api/uploads"),
      payload: uploadBody(tinyData()),
      headers: { ...(await deviceHeaders()), "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(ERROR_STATUS.forbidden);
    expect(response.json().error.code).toBe("forbidden");
    expect(seen).toEqual([]);
  });

  it("forwards an owner upload to the gateway", async () => {
    const seen: GatewayRequest[] = [];
    ctx = await startTestServer({ gateway: echoGateway(seen) });
    const body = uploadBody(tinyData());
    const response = await ctx.request({
      method: "POST",
      url: proxied("/api/uploads"),
      payload: body,
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.body?.toString()).toBe(body);
  });

  it("rejects a declared over-limit upload with too_large, never reaching the gateway", async () => {
    const seen: GatewayRequest[] = [];
    ctx = await startTestServer({ gateway: echoGateway(seen) });
    const response = await ctx.request({
      method: "POST",
      url: proxied("/api/uploads"),
      payload: Buffer.alloc(UPLOAD_BODY_LIMIT + 1, 97),
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(ERROR_STATUS.too_large);
    expect(response.json().error.code).toBe("too_large");
    expect(seen).toEqual([]);
  });

  it("rejects a chunked over-limit upload with too_large, never reaching the gateway", async () => {
    const seen: GatewayRequest[] = [];
    ctx = await startTestServer({ gateway: echoGateway(seen) });
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: ctx.server.port,
          path: proxied("/api/uploads"),
          method: "POST",
          headers: { ...ctx.headers, "content-type": "application/json", "transfer-encoding": "chunked" },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      // The server answers 413 and closes the socket mid-body; later writes fail with EPIPE.
      req.on("error", () => undefined);
      const timer = setTimeout(() => reject(new Error("no response to the chunked upload")), 10_000);
      const chunk = Buffer.alloc(512 * 1024, 98);
      const writes = Math.ceil(UPLOAD_BODY_LIMIT / chunk.length) + 1;
      let sent = 0;
      const pump = (): void => {
        // Never wait for drain: the server stops reading once the route limit trips.
        if (sent >= writes || req.destroyed) return void req.end();
        sent += 1;
        try {
          req.write(chunk, () => setImmediate(pump));
        } catch {
          req.end();
        }
      };
      req.on("response", () => clearTimeout(timer));
      req.on("close", () => clearTimeout(timer));
      pump();
    });
    expect(status).toBe(ERROR_STATUS.too_large);
    expect(seen).toEqual([]);
  });

  it("lets a valid 5 MiB file upload through to the gateway", async () => {
    const seen: GatewayRequest[] = [];
    ctx = await startTestServer({ gateway: echoGateway(seen) });
    const data = Buffer.alloc(5 * 1024 * 1024, 99).toString("base64");
    expect(Buffer.byteLength(uploadBody(data))).toBeLessThan(UPLOAD_BODY_LIMIT);
    const response = await ctx.request({
      method: "POST",
      url: proxied("/api/uploads"),
      payload: uploadBody(data),
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.body?.length).toBe(Buffer.byteLength(uploadBody(data)));
  });
});

describe("remote upload staged on the destination node", () => {
  let a: TestNode;
  let b: TestNode;
  afterEach(async () => {
    await a?.stop();
    await b?.stop();
  });

  it("stages through the hub proxy and the ref validates only on the destination", async () => {
    a = await startNode("Alpha");
    b = await startNode("Bravo");
    await linkNodes(a, b);
    const data = Buffer.from("remote bytes").toString("base64");
    const staged = await a.ctx.request({
      method: "POST",
      url: viaNode(b, "/api/uploads"),
      payload: { name: "notes.txt", mimeType: "text/plain", data },
    });
    expect(staged.statusCode).toBe(201);
    const ref = staged.json() as { name: string; path: string; size: number };
    expect(ref).toMatchObject({ name: "notes.txt", size: 12 });
    const startOn = async (host: TestNode) => {
      const made = await host.ctx.request({
        method: "POST",
        url: "/api/projects",
        payload: { path: "/Users/demo/project" },
      });
      const project = made.json() as { id: string };
      return host.ctx.request({
        method: "POST",
        url: "/api/conversations",
        payload: { projectId: project.id, text: "use this", files: [ref], requestId: `r-${host.name}` },
      });
    };
    expect((await startOn(b)).statusCode).toBe(201);
    const foreign = await startOn(a);
    expect(foreign.statusCode).toBe(ERROR_STATUS.file_expired);
    expect(foreign.json().error.code).toBe("file_expired");
  }, 30_000);
});

describe("node routes on the hub", () => {
  it("lists, renames and disconnects through Core.nodes", async () => {
    ctx = await startTestServer({ fake: { nodes: true } });
    const list = (await ctx.request({ url: "/api/nodes" })).json() as Array<{ id: string; name: string }>;
    expect(list.map((node) => node.name)).toEqual(["Homelab", "Work laptop"]);
    const id = list[0]?.id ?? "";
    expect(
      (await ctx.request({ method: "PUT", url: `/api/nodes/${id}`, payload: { name: "NAS" } })).statusCode,
    ).toBe(204);
    expect(((await ctx.request({ url: "/api/nodes" })).json() as Array<{ name: string }>)[0]?.name).toBe(
      "NAS",
    );
    const self = (await ctx.request({ url: "/api/nodes/self" })).json() as { nodeId: string; name: string };
    expect(self.nodeId.length).toBeGreaterThan(0);
    expect(list.map((node) => node.id)).not.toContain(self.nodeId);
  });
});
