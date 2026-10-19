import { createHash } from "node:crypto";
import { LINK_CLOSE_UPDATE_REQUIRED, LIVE_PATH, machineApiPrefix, terminalStreamPath } from "@tau/protocol";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { startTestServer, type TestServer } from "../testing/harness";
import {
  connectLoopbackMachine,
  fastifyHandler,
  type LoopbackMachine,
  type PeerHandlers,
  type PeerRequest,
} from "../testing/loopback-machine";

let ctx: TestServer;
let peers: LoopbackMachine[] = [];
let browsers: WebSocket[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const browser of browsers) browser.terminate();
  browsers = [];
  for (const peer of peers) peer.stop();
  peers = [];
  await ctx.server.close();
  await ctx.core.close();
});

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

async function linkPeer(
  handlers: PeerHandlers,
  options: { hello?: { protocolVersion: string }; withholdCredit?: boolean } = {},
) {
  const minted = await ctx.core.access.mintPairing({ kind: "machine" });
  const redeemed = await ctx.core.access.redeemPairing({
    code: minted.code,
    deviceName: "Loopback",
    peer: "127.0.0.1",
  });
  const peer = await connectLoopbackMachine({
    port: ctx.server.port,
    secret: redeemed.secret,
    handlers,
    ...options,
  });
  peers.push(peer);
  await vi.waitFor(async () => expect(await ctx.core.machines.list()).toHaveLength(1));
  return { peer, id: redeemed.deviceId, prefix: machineApiPrefix(redeemed.deviceId) };
}

async function appHandler(register: (app: FastifyInstance) => void): Promise<PeerHandlers> {
  const app = Fastify();
  register(app);
  await app.ready();
  return { request: fastifyHandler(app) };
}

const dialBrowser = (path: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${ctx.server.port}${path}`, { headers: ctx.headers });
    browsers.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
const closeOf = (socket: WebSocket) => new Promise<number>((resolve) => socket.once("close", resolve));
const nextMessage = (socket: WebSocket) =>
  new Promise<{ data: Buffer; isBinary: boolean }>((resolve) =>
    socket.once("message", (data, isBinary) => resolve({ data: data as Buffer, isBinary })),
  );

const echoStreams: Pick<PeerHandlers, "open"> = {
  open: (_path, send) => ({ onMessage: (payload, text) => send(payload, text) }),
};

describe("machine gateway over a loopback link", () => {
  it("answers a GET through /api/m/<id>/api/... from a real machine app, with the device label", async () => {
    ctx = await startTestServer();
    const seen: PeerRequest[] = [];
    const handlers = await appHandler((app) =>
      app.get("/api/conversations", async (request, reply) => {
        reply.header("set-cookie", "tau_device=planted");
        reply.header("content-type", "application/json");
        return {
          projectId: (request.query as { projectId?: string }).projectId,
          label: request.headers["x-tau-hub-device"],
        };
      }),
    );
    const { prefix } = await linkPeer({
      ...handlers,
      request: async (request) => {
        seen.push(request);
        return handlers.request(request);
      },
    });
    const response = await ctx.request({ url: `${prefix}/api/conversations?projectId=p1` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ projectId: "p1", label: "owner" });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(seen).toHaveLength(1);
  });

  it("moves a 5 MB response and a 42 MB request body intact, in chunks of at most 256 KB", async () => {
    ctx = await startTestServer();
    const image = Buffer.alloc(5 * 1024 * 1024, 7);
    let received = "";
    const { peer, prefix } = await linkPeer({
      request: (request) => {
        received = sha(request.body);
        return { status: 200, headers: { "content-type": "image/png" }, body: image };
      },
    });
    const response = await ctx.request({ url: `${prefix}/api/projects/p1/icon` });
    expect(sha(response.rawPayload)).toBe(sha(image));
    const body = Buffer.alloc(42 * 1024 * 1024 - 1024, 99);
    const ok = await ctx.request({
      method: "POST",
      url: `${prefix}/api/conversations/c1/messages`,
      payload: body,
      headers: { "content-type": "application/json" },
    });
    expect(ok.statusCode).toBe(200);
    expect(received).toBe(sha(body));
    expect(peer.maxDataFrame()).toBeLessThanOrEqual(256 * 1024);
  });

  it("serves 20 parallel requests", async () => {
    ctx = await startTestServer();
    const { prefix } = await linkPeer({
      request: (request) => ({ status: 200, headers: {}, body: Buffer.from(request.query) }),
    });
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => ctx.request({ url: `${prefix}/api/conversations?n=${i}` })),
    );
    expect(responses.map((response) => response.body)).toEqual(
      Array.from({ length: 20 }, (_, i) => `n=${i}`),
    );
  });

  it("pipes a /live-like text stream and a terminal-like binary stream, queueing early frames", async () => {
    ctx = await startTestServer();
    const { prefix } = await linkPeer({
      request: () => ({ status: 200, headers: {}, body: Buffer.alloc(0) }),
      ...echoStreams,
    });
    const live = await dialBrowser(`${prefix}${LIVE_PATH}`);
    const text = nextMessage(live);
    live.send("hello");
    const liveReply = await text;
    expect(liveReply.isBinary).toBe(false);
    expect(liveReply.data.toString()).toBe("hello");
    const terminal = await dialBrowser(`${prefix}${terminalStreamPath("t1")}`);
    const binary = nextMessage(terminal);
    terminal.send(Buffer.from([1, 2, 3, 255, 0, 9]));
    const terminalReply = await binary;
    expect(terminalReply.isBinary).toBe(true);
    expect([...terminalReply.data]).toEqual([1, 2, 3, 255, 0, 9]);
    const big = Buffer.alloc(60 * 1024, 5);
    const bigReply = nextMessage(terminal);
    terminal.send(big);
    expect((await bigReply).data.equals(big)).toBe(true);
  });

  it("does not let a stalled browser stream stall requests or other streams", async () => {
    ctx = await startTestServer();
    let flood: ((payload: Uint8Array) => void) | undefined;
    const { prefix } = await linkPeer({
      request: () => ({ status: 200, headers: {}, body: Buffer.from("ok") }),
      open: (path, send) => {
        if (path.includes("flood")) flood = send;
        return { onMessage: (payload, text) => send(payload, text) };
      },
    });
    const stalled = await dialBrowser(`${prefix}${terminalStreamPath("flood")}`);
    stalled.pause();
    stalled.send(Buffer.from("go"));
    await vi.waitFor(() => expect(flood).toBeDefined());
    for (let i = 0; i < 80; i++) flood?.(Buffer.alloc(256 * 1024, 1));
    const echo = await dialBrowser(`${prefix}${LIVE_PATH}`);
    const reply = nextMessage(echo);
    echo.send("still alive");
    expect((await reply).data.toString()).toBe("still alive");
    const started = Date.now();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => ctx.request({ url: `${prefix}/api/conversations` })),
    );
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("closes a stream with 1013 after 60 s without credit, and keeps the link", async () => {
    ctx = await startTestServer();
    const { peer, id, prefix } = await linkPeer(
      { request: () => ({ status: 200, headers: {}, body: Buffer.from("ok") }), ...echoStreams },
      { withholdCredit: true },
    );
    const socket = await dialBrowser(`${prefix}${LIVE_PATH}`);
    for (let i = 0; i < 24; i++) socket.send(Buffer.alloc(60 * 1024, 1));
    await vi.waitFor(() => expect(peer.socket.bufferedAmount).toBe(0));
    await new Promise((resolve) => setTimeout(resolve, 100));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const closed = closeOf(socket);
    for (let second = 0; second < 62; second++) {
      vi.advanceTimersByTime(1000);
      await peer.ping();
    }
    expect(await closed).toBe(1013);
    await vi.waitFor(() => expect(peer.closeFrames.some((frame) => frame.code === 1013)).toBe(true));
    vi.useRealTimers();
    const machine = (await ctx.core.machines.list()).find((m) => m.id === id);
    expect(machine?.status).toBe("online");
    expect((await ctx.request({ url: `${prefix}/api/conversations` })).statusCode).toBe(200);
  });

  it("marks the machine offline after 45 s without a frame and closes the link", async () => {
    ctx = await startTestServer();
    const { peer, id, prefix } = await linkPeer({
      request: () => ({ status: 200, headers: {}, body: Buffer.alloc(0) }),
    });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.advanceTimersByTime(44_000);
    expect((await ctx.core.machines.list()).find((m) => m.id === id)?.status).not.toBe("offline");
    vi.advanceTimersByTime(2000);
    await peer.closed;
    vi.useRealTimers();
    expect((await ctx.core.machines.list()).find((m) => m.id === id)?.status).toBe("offline");
    expect((await ctx.request({ url: `${prefix}/api/conversations` })).statusCode).toBe(404);
  });

  it("marks the machine offline when the link drops and closes its proxied sockets with 1013", async () => {
    ctx = await startTestServer();
    const { peer, id, prefix } = await linkPeer({
      request: () => ({ status: 200, headers: {}, body: Buffer.alloc(0) }),
      ...echoStreams,
    });
    const socket = await dialBrowser(`${prefix}${LIVE_PATH}`);
    const closed = closeOf(socket);
    peer.stop();
    expect(await closed).toBe(1013);
    await vi.waitFor(async () =>
      expect((await ctx.core.machines.list()).find((m) => m.id === id)?.status).toBe("offline"),
    );
  });

  it("closes proxied streams and the link when the machine is revoked", async () => {
    ctx = await startTestServer();
    const { peer, id, prefix } = await linkPeer({
      request: () => ({ status: 200, headers: {}, body: Buffer.alloc(0) }),
      ...echoStreams,
    });
    const socket = await dialBrowser(`${prefix}${LIVE_PATH}`);
    const closed = closeOf(socket);
    expect((await ctx.request({ method: "DELETE", url: `/api/machines/${id}` })).statusCode).toBe(204);
    expect(await closed).toBe(1008);
    expect(await peer.closed).toBe(1008);
    expect((await ctx.request({ url: `${prefix}/api/conversations` })).statusCode).toBe(404);
  });

  it("filters paths before the machine sees them", async () => {
    ctx = await startTestServer();
    let calls = 0;
    const { prefix } = await linkPeer({
      request: () => {
        calls++;
        return { status: 200, headers: {}, body: Buffer.alloc(0) };
      },
    });
    for (const path of ["/api/access/devices", "/api/remote", "/api/machines", "/api/pair", "/api/health"])
      expect((await ctx.request({ url: `${prefix}${path}` })).statusCode, path).toBe(403);
    expect((await ctx.request({ url: `${prefix}/api/nope` })).statusCode).toBe(404);
    expect(calls).toBe(0);
  });

  it("closes a version-skewed machine's link with the update code", async () => {
    ctx = await startTestServer();
    const { peer } = await linkPeer(
      { request: () => ({ status: 200, headers: {}, body: Buffer.alloc(0) }) },
      { hello: { protocolVersion: "older" } },
    );
    expect(await peer.closed).toBe(LINK_CLOSE_UPDATE_REQUIRED);
  });

  it("answers not_found for a machine that never linked", async () => {
    ctx = await startTestServer();
    expect((await ctx.request({ url: `${machineApiPrefix("nobody")}/api/conversations` })).statusCode).toBe(
      404,
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${ctx.server.port}${machineApiPrefix("nobody")}${LIVE_PATH}`,
      { headers: ctx.headers },
    );
    socket.on("error", () => undefined);
    expect(await closeOf(socket)).toBe(1013);
  });
});
