import {
  decodeServerFrame,
  encodeFrame,
  isBaseOps,
  isRetiredOps,
  LIVE_PATH,
  type OpsFrame,
  type ServerFrame,
} from "@pi-everywhere/protocol";
import { createFakeCore } from "@pi-everywhere/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { waitForDrain } from "./live/backpressure";
import { startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await ctx.server.close();
  await ctx.core.close();
});

function connect(headers: Record<string, string> = {}): WebSocket {
  const { host: _host, ...base } = ctx.headers;
  const socket = new WebSocket(`ws://127.0.0.1:${ctx.server.port}${LIVE_PATH}`, {
    headers: { ...base, ...headers },
  });
  sockets.push(socket);
  return socket;
}

const opened = (socket: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

const rejectedStatus = (socket: WebSocket) =>
  new Promise<number>((resolve) => {
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.once("error", () => undefined);
  });

function framesOf(socket: WebSocket) {
  const frames: ServerFrame[] = [];
  const waiters: Array<() => void> = [];
  socket.on("message", (data) => {
    const frame = decodeServerFrame(data.toString());
    if (frame) frames.push(frame);
    for (const waiter of waiters.splice(0)) waiter();
  });
  async function next(predicate: (frame: ServerFrame) => boolean): Promise<ServerFrame> {
    for (;;) {
      const found = frames.find(predicate);
      if (found) return found;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  }
  async function nextOps(accept: (frame: OpsFrame) => boolean = () => true): Promise<OpsFrame> {
    return (await next((frame) => frame.type === "ops" && accept(frame))) as OpsFrame;
  }
  return { frames, next, nextOps };
}

const subscribe = (socket: WebSocket, conversationId: string) =>
  socket.send(encodeFrame({ type: "subscribe", conversationId }));

let startCounter = 0;

async function createConversation(): Promise<string> {
  const project = (
    await ctx.request({ method: "POST", url: "/api/projects", payload: { path: "/Users/demo/project" } })
  ).json();
  const started = await ctx.request({
    method: "POST",
    url: "/api/conversations",
    payload: { projectId: project.id, text: "hello", requestId: `start-${++startCounter}` },
  });
  return started.json().id;
}

describe("WebSocket security", () => {
  it("rejects a foreign or missing Origin on upgrade", async () => {
    ctx = await startTestServer();
    expect(await rejectedStatus(connect({ origin: "http://evil.example" }))).toBe(403);
    const { origin: _origin, ...rest } = ctx.headers;
    const socket = new WebSocket(`ws://127.0.0.1:${ctx.server.port}${LIVE_PATH}`, {
      headers: { cookie: rest.cookie ?? "" },
    });
    sockets.push(socket);
    expect(await rejectedStatus(socket)).toBe(403);
  });

  it("rejects a foreign Host on upgrade", async () => {
    ctx = await startTestServer();
    expect(await rejectedStatus(connect({ Host: "evil.example" }))).toBe(403);
  });

  it("rejects an upgrade without the session cookie", async () => {
    ctx = await startTestServer();
    expect(await rejectedStatus(connect({ cookie: "" }))).toBe(401);
    expect(await rejectedStatus(connect({ cookie: `pie_${ctx.server.port}=wrong` }))).toBe(401);
  });
});

describe("WebSocket /api/live", () => {
  it("sends a base view first, then forwards ops", async () => {
    ctx = await startTestServer();
    const id = await createConversation();
    const socket = connect();
    await opened(socket);
    const received = framesOf(socket);
    subscribe(socket, id);
    const base = await received.nextOps();
    expect(base.conversationId).toBe(id);
    expect(isBaseOps(base.ops)).toBe(true);
    await ctx.request({
      method: "POST",
      url: `/api/conversations/${id}/messages`,
      payload: { text: "hi", requestId: "r1" },
    });
    await received.nextOps((frame) => !isBaseOps(frame.ops));
  });

  it("answers an unknown conversation with a retired view", async () => {
    ctx = await startTestServer();
    const socket = connect();
    await opened(socket);
    const received = framesOf(socket);
    subscribe(socket, "nope");
    expect(isRetiredOps((await received.nextOps()).ops)).toBe(true);
  });

  it("broadcasts changed frames from core.onChange to every socket", async () => {
    ctx = await startTestServer();
    const [first, second] = [connect(), connect()];
    await Promise.all([opened(first), opened(second)]);
    const [a, b] = [framesOf(first), framesOf(second)];
    await ctx.request({ method: "POST", url: "/api/projects", payload: { path: "/Users/demo/project" } });
    for (const received of [a, b]) {
      expect(await received.next((frame) => frame.type === "changed")).toEqual({
        type: "changed",
        resource: "projects",
      });
    }
  });

  it("stops watchers on unsubscribe and on close", async () => {
    const core = createFakeCore({ configured: true, speed: 1000 });
    const stops = vi.fn();
    const watch = core.conversations.watch.bind(core.conversations);
    core.conversations.watch = async (id, onOps) => {
      const watcher = await watch(id, onOps);
      return {
        stop: async () => {
          stops();
          await watcher.stop();
        },
      };
    };
    ctx = await startTestServer({ core });
    const id = await createConversation();
    const socket = connect();
    await opened(socket);
    const received = framesOf(socket);
    subscribe(socket, id);
    await received.nextOps();
    socket.send(encodeFrame({ type: "unsubscribe", conversationId: id }));
    await vi.waitFor(() => expect(stops).toHaveBeenCalledTimes(1));
    subscribe(socket, id);
    await vi.waitFor(() => expect(received.frames.filter((f) => f.type === "ops")).toHaveLength(2));
    socket.close();
    await vi.waitFor(() => expect(stops).toHaveBeenCalledTimes(2));
  });

  it("closes the socket on an invalid frame", async () => {
    ctx = await startTestServer();
    const socket = connect();
    await opened(socket);
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    socket.send("not json");
    expect(await closed).toBe(1008);
  });
});

describe("backpressure", () => {
  it("waits while bufferedAmount is high and resumes once it drains", async () => {
    const socket = { OPEN: 1, readyState: 1, bufferedAmount: 5 * 1024 * 1024 } as unknown as WebSocket;
    let drained = false;
    const done = waitForDrain(socket).then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(drained).toBe(false);
    (socket as { bufferedAmount: number }).bufferedAmount = 0;
    await done;
    expect(drained).toBe(true);
  });

  it("gives up when the socket closes", async () => {
    const socket = { OPEN: 1, readyState: 3, bufferedAmount: 5 * 1024 * 1024 } as unknown as WebSocket;
    await waitForDrain(socket);
  });
});
