import { createHash } from "node:crypto";
import { ERROR_STATUS, LIVE_PATH, terminalStreamPath, UPLOAD_BODY_LIMIT } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { linkRaw, type RawLink, type RealRole, ROLES } from "../testing/raw-link";
import type { RawHandlers } from "../testing/raw-peer";
import { startNode, type TestNode, viaNode } from "../testing/two-nodes";

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const ok = { status: 200, headers: {}, body: Buffer.from("ok") };

let node: TestNode;
let link: RawLink | undefined;
const browsers: WebSocket[] = [];
beforeEach(async () => {
  node = await startNode("Real");
});
afterEach(async () => {
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
const nextMessage = (socket: WebSocket) =>
  new Promise<{ data: Buffer; isBinary: boolean }>((resolve) =>
    socket.once("message", (data, isBinary) => resolve({ data: data as Buffer, isBinary })),
  );
const echo: Pick<RawHandlers, "open"> = {
  open: (_path, send) => ({ onMessage: (payload, text) => send(payload, text) }),
};

describe.each(ROLES)("requests to the remote node (the real node is the %s)", (role: RealRole) => {
  it("answers a GET with the label, drops set-cookie and keeps the allowed headers", async () => {
    const seen: string[] = [];
    link = await linkRaw(node, role, {
      handlers: {
        request: (request) => {
          seen.push(`${request.method} ${request.path}?${request.query} via=${request.via}`);
          return {
            status: 200,
            headers: { "set-cookie": "tau_device=planted", "content-type": "text/plain" },
            body: Buffer.from("hi"),
          };
        },
      },
    });
    const response = await node.ctx.request({
      url: `/api/n/${link.peer.nodeId}/api/conversations?projectId=p1`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("hi");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(seen).toEqual(["GET /api/conversations?projectId=p1 via=owner"]);
  });

  // 47 MB through a real link: the 5 s default is too short on a loaded machine.
  it("moves a 5 MB response and a 42 MB request body intact, in chunks of at most 256 KB", async () => {
    const image = Buffer.alloc(5 * 1024 * 1024, 7);
    let received = "";
    link = await linkRaw(node, role, {
      handlers: {
        request: (request) => {
          // The summary writer's GETs share this handler and could overwrite the POST's hash.
          if (request.method === "POST") received = sha(request.body);
          return { status: 200, headers: { "content-type": "image/png" }, body: image };
        },
      },
    });
    const prefix = `/api/n/${link.peer.nodeId}`;
    const response = await node.ctx.request({ url: `${prefix}/api/projects/p1/icon` });
    expect(sha(response.rawPayload)).toBe(sha(image));
    const body = Buffer.alloc(42 * 1024 * 1024 - 1024, 99);
    const sent = await node.ctx.request({
      method: "POST",
      url: `${prefix}/api/conversations/c1/messages`,
      payload: body,
      headers: { "content-type": "application/json" },
    });
    expect(sent.statusCode).toBe(200);
    expect(received).toBe(sha(body));
    expect(link.peer.maxDataFrame).toBeLessThanOrEqual(256 * 1024);
  }, 30_000);

  it("serves 20 parallel requests", async () => {
    link = await linkRaw(node, role, {
      handlers: { request: (request) => ({ status: 200, headers: {}, body: Buffer.from(request.query) }) },
    });
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        node.ctx.request({ url: `/api/n/${link?.peer.nodeId}/api/conversations?n=${i}` }),
      ),
    );
    expect(responses.map((response) => response.body)).toEqual(
      Array.from({ length: 20 }, (_, i) => `n=${i}`),
    );
  });

  it("pipes a /live text stream and a terminal binary stream, queueing early frames until ready", async () => {
    link = await linkRaw(node, role, { handlers: { request: () => ok, ...echo } });
    const prefix = `/api/n/${link.peer.nodeId}`;
    const live = await dialBrowser(`${prefix}${LIVE_PATH}`);
    const text = nextMessage(live);
    live.send("hello");
    const liveReply = await text;
    expect(liveReply.isBinary).toBe(false);
    expect(liveReply.data.toString()).toBe("hello");
    const terminal = await dialBrowser(`${prefix}${terminalStreamPath("t1")}`);
    const binary = nextMessage(terminal);
    terminal.send(Buffer.from([1, 2, 3, 255, 0, 9]));
    const reply = await binary;
    expect(reply.isBinary).toBe(true);
    expect([...reply.data]).toEqual([1, 2, 3, 255, 0, 9]);
    const big = Buffer.alloc(60 * 1024, 5);
    const bigReply = nextMessage(terminal);
    terminal.send(big);
    expect((await bigReply).data.equals(big)).toBe(true);
  });

  it("does not let a stalled browser stream stall requests or other streams", async () => {
    let flood: ((payload: Uint8Array) => void) | undefined;
    link = await linkRaw(node, role, {
      handlers: {
        request: () => ok,
        open: (path, send) => {
          if (path.includes("flood")) flood = send;
          return { onMessage: (payload, text) => send(payload, text) };
        },
      },
    });
    const prefix = `/api/n/${link.peer.nodeId}`;
    const stalled = await dialBrowser(`${prefix}${terminalStreamPath("flood")}`);
    stalled.pause();
    stalled.send(Buffer.from("go"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (let i = 0; i < 80; i++) flood?.(Buffer.alloc(256 * 1024, 1));
    const live = await dialBrowser(`${prefix}${LIVE_PATH}`);
    const reply = nextMessage(live);
    live.send("still alive");
    expect((await reply).data.toString()).toBe("still alive");
    const started = Date.now();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => node.ctx.request({ url: `${prefix}/api/conversations` })),
    );
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("refuses an over-limit upload at the destination responder, and stages a valid one there", async () => {
    link = await linkRaw(node, role, { handlers: { request: () => ok } });
    const big = await link.peer.request({
      method: "POST",
      path: "/api/uploads",
      body: Buffer.alloc(UPLOAD_BODY_LIMIT + 1, 97),
      contentType: "application/json",
    });
    expect(big.status).toBe(ERROR_STATUS.too_large);
    const data = Buffer.from("hi").toString("base64");
    const small = await link.peer.request({
      method: "POST",
      path: "/api/uploads",
      body: Buffer.from(JSON.stringify({ name: "n.txt", mimeType: "text/plain", data })),
      contentType: "application/json",
    });
    expect(small.status).toBe(201);
    expect(JSON.parse(small.body.toString())).toMatchObject({ name: "n.txt", size: 2 });
  });

  it("answers not_found for a node that never linked", async () => {
    link = await linkRaw(node, role, { handlers: { request: () => ok } });
    expect(
      (await node.ctx.request({ url: viaNode({ nodeId: "nobody" } as TestNode, "/api/conversations") }))
        .statusCode,
    ).toBe(404);
  });
});
