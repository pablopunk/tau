import { LINK_CLOSE_POLICY, LIVE_PATH, terminalStreamPath } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { linkRaw, type RawLink, type RealRole, ROLES } from "../testing/raw-link";
import { startNode, type TestNode } from "../testing/two-nodes";
import { sanitiseVia } from "./device-labels";

let node: TestNode;
let link: RawLink | undefined;
const browsers: WebSocket[] = [];
beforeEach(async () => {
  node = await startNode("Real");
});
afterEach(async () => {
  vi.useRealTimers();
  for (const browser of browsers.splice(0)) browser.terminate();
  await link?.stop();
  link = undefined;
  await node.stop();
});

const dialBrowser = (path: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${node.ctx.server.port}${path}`, {
      headers: node.ctx.headers,
    });
    browsers.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
const closeOf = (socket: WebSocket) => new Promise<number>((resolve) => socket.once("close", resolve));
const ok = { status: 200, headers: {}, body: Buffer.from("ok") };
/** The ids the RAW peer may start: odd when it dialled, even when it accepted; the other parity is wrong. */
const wrongParity = (real: RealRole) => (real === "acceptor" ? 2 : 1);
const rightParity = (real: RealRole) => (real === "acceptor" ? 1 : 2);

describe.each(ROLES)("stream rules (the real node is the %s)", (role) => {
  it("closes the link 1008 on a peer-started request with the wrong id parity", async () => {
    link = await linkRaw(node, role, { handlers: { request: () => ok } });
    link.peer.sendControl({
      type: "request",
      id: wrongParity(role),
      method: "GET",
      path: "/api/projects",
      query: "",
      via: "x",
    });
    expect((await link.peer.closed).code).toBe(LINK_CLOSE_POLICY);
  });

  it("closes the link 1008 on a reused stream id", async () => {
    link = await linkRaw(node, role, { handlers: { request: () => ok } });
    const id = rightParity(role);
    const frame = {
      type: "request",
      id,
      method: "POST",
      path: "/api/conversations/c1/messages",
      query: "",
      via: "x",
      bodyBytes: 10,
    };
    link.peer.sendControl(frame);
    link.peer.sendControl(frame);
    expect((await link.peer.closed).code).toBe(LINK_CLOSE_POLICY);
  });

  it("closes the link 1008 on a stray ready, and ignores data for a stream that was never opened", async () => {
    link = await linkRaw(node, role, { handlers: { request: () => ok } });
    link.peer.sendData({ id: 998, end: false, text: false, payload: Buffer.from("x") });
    await link.peer.ping();
    link.peer.sendControl({ type: "ready", id: 1000 });
    expect((await link.peer.closed).code).toBe(LINK_CLOSE_POLICY);
  });

  it("does not send a browser's frames until the peer said ready (data never implies ready)", async () => {
    link = await linkRaw(node, role, { holdReady: true, handlers: { request: () => ok, open: () => ({}) } });
    const browser = await dialBrowser(`/api/n/${link.peer.nodeId}${LIVE_PATH}`);
    browser.send("early");
    await vi.waitFor(() => expect(link?.peer.received("open")).toHaveLength(1));
    const [open] = link.peer.received("open");
    link.peer.sendData({ id: open?.id ?? 0, end: false, text: true, payload: Buffer.from("from the peer") });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(link.peer.dataFramesReceived).toBe(0);
    link.peer.sendReady(open?.id ?? 0);
    await vi.waitFor(() => expect(link?.peer.dataFramesReceived).toBe(1));
  });

  it("closes a stream 1013 after 60 s without credit, and keeps the link", async () => {
    link = await linkRaw(node, role, {
      withholdCredit: true,
      handlers: {
        request: () => ok,
        open: (_path, send) => ({ onMessage: (payload, text) => send(payload, text) }),
      },
    });
    const socket = await dialBrowser(`/api/n/${link.peer.nodeId}${LIVE_PATH}`);
    for (let i = 0; i < 24; i++) socket.send(Buffer.alloc(60 * 1024, 1));
    await vi.waitFor(() => expect(socket.bufferedAmount).toBe(0));
    await new Promise((resolve) => setTimeout(resolve, 200));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const closed = closeOf(socket);
    for (let second = 0; second < 62; second++) {
      vi.advanceTimersByTime(1000);
      await link.peer.ping();
    }
    expect(await closed).toBe(1013);
    await vi.waitFor(() => expect(link?.peer.closeFrames.some((frame) => frame.code === 1013)).toBe(true));
    vi.useRealTimers();
    expect((await node.ctx.request({ url: `/api/n/${link.peer.nodeId}/api/conversations` })).statusCode).toBe(
      200,
    );
  });

  it("closes the link and marks the peer offline after 45 s without a frame", async () => {
    link = await linkRaw(node, role, { handlers: { request: () => ok } });
    const id = link.peer.nodeId;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.advanceTimersByTime(44_000);
    expect((await node.core.nodes.list()).find((entry) => entry.id === id)?.status).not.toBe("offline");
    vi.advanceTimersByTime(2000);
    await link.peer.closed;
    vi.useRealTimers();
    await vi.waitFor(async () =>
      expect((await node.core.nodes.list()).find((entry) => entry.id === id)?.status).toBe("offline"),
    );
    expect((await node.ctx.request({ url: `/api/n/${id}/api/conversations` })).statusCode).toBe(404);
  });

  it("closes proxied browser sockets 1013 when the link drops, and marks the node offline", async () => {
    link = await linkRaw(node, role, { handlers: { request: () => ok, open: () => ({}) } });
    const id = link.peer.nodeId;
    const socket = await dialBrowser(`/api/n/${id}${LIVE_PATH}`);
    const closed = closeOf(socket);
    link.peer.stop();
    expect(await closed).toBe(1013);
    await vi.waitFor(async () =>
      expect((await node.core.nodes.list()).find((entry) => entry.id === id)?.status).toBe("offline"),
    );
  });
});

describe.each(ROLES)("the responder for requests from the peer (the real node is the %s)", (role) => {
  it("calls its own server on loopback and streams the answer back", async () => {
    link = await linkRaw(node, role);
    const response = await link.peer.request({ path: "/api/projects" });
    expect(response.status).toBe(200);
    expect(Array.isArray(JSON.parse(response.body.toString()))).toBe(true);
  });

  it("refuses denylisted paths, /api/n/** and the link paths, for every method, without reaching loopback", async () => {
    link = await linkRaw(node, role);
    const paths = [
      "/api/access/devices",
      "/api/access",
      "/api/remote",
      "/api/nodes",
      "/api/nodes/link",
      "/api/pair",
      "/api/health",
      "/api/update/refresh",
      `/api/n/${link.peer.nodeId}/api/projects`,
      "/api/n/x/api/live",
    ];
    for (const path of paths) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const response = await link.peer.request({ method, path });
        expect([403, 404], `${method} ${path}`).toContain(response.status);
      }
    }
    expect((await link.peer.request({ path: "/api/nope" })).status).toBe(404);
    expect((await link.peer.request({ path: "/not/api" })).status).toBe(404);
    expect((await link.peer.request({ path: "/api/%2e%2e/access/devices" })).status).toBe(403);
  });

  it("refuses a query that could split the request line, and a body above the route's limit", async () => {
    link = await linkRaw(node, role);
    expect((await link.peer.request({ path: "/api/projects", query: "a b" })).status).toBe(400);
    expect((await link.peer.request({ path: "/api/projects", query: "a#b" })).status).toBe(400);
    const large = await link.peer.request({
      method: "POST",
      path: "/api/projects",
      body: Buffer.alloc(3 * 1024 * 1024),
    });
    expect(large.status).toBe(413);
  });

  it("refuses a socket path that is not /api/live or a terminal stream, and refuses an HTTP path as a socket", async () => {
    link = await linkRaw(node, role);
    for (const path of ["/api/projects", "/api/access/devices", "/api/nodes/link"]) {
      const stream = link.peer.openStream(path);
      expect((await stream.closed).code, path).toBe(LINK_CLOSE_POLICY);
    }
  });

  it("pipes /live from this server to the peer, ready first", async () => {
    link = await linkRaw(node, role);
    const stream = link.peer.openStream(LIVE_PATH);
    await stream.ready;
    const project = (
      await node.ctx.request({
        method: "POST",
        url: "/api/projects",
        payload: { path: "/Users/demo/project" },
      })
    ).json();
    const started = await node.ctx.request({
      method: "POST",
      url: "/api/conversations",
      payload: { projectId: project.id, text: "hi", requestId: "r1" },
    });
    const { encodeFrame } = await import("@tau/protocol");
    stream.send(Buffer.from(encodeFrame({ type: "subscribe", conversationId: started.json().id })), true);
    await vi.waitFor(() => expect(stream.messages.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(stream.messages[0]?.text).toBe(true);
  });

  it("pipes a binary terminal stream", async () => {
    link = await linkRaw(node, role);
    const project = (
      await node.ctx.request({
        method: "POST",
        url: "/api/projects",
        payload: { path: "/Users/demo/project" },
      })
    ).json();
    const started = await node.ctx.request({
      method: "POST",
      url: "/api/conversations",
      payload: { projectId: project.id, text: "hi", requestId: "r2" },
    });
    const opened = await node.ctx.request({
      method: "POST",
      url: `/api/conversations/${started.json().id}/terminals`,
      payload: { cols: 80, rows: 24 },
    });
    const stream = link.peer.openStream(terminalStreamPath(opened.json().id));
    await stream.ready;
    stream.send(Buffer.from("echo hi\r"));
    await vi.waitFor(() => expect(stream.messages.length).toBeGreaterThan(0), { timeout: 5000 });
  });

  it("closes the link 1008 on a via longer than the schema allows", async () => {
    link = await linkRaw(node, role);
    void link.peer.request({ path: "/api/projects", via: "x".repeat(121) });
    expect((await link.peer.closed).code).toBe(LINK_CLOSE_POLICY);
  });
});

describe("the audit label", () => {
  it("turns control characters into spaces and is at most 120 characters", () => {
    expect(sanitiseVia("a\nb\u0000c")).toBe("a b c");
    expect(sanitiseVia("é".repeat(300))).toHaveLength(120);
  });
});
