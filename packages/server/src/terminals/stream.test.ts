import { TERMINAL_STREAM_MAX_INPUT_BYTES, terminalStreamPath } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startTestServer, type TestServer } from "../testing/harness";

let ctx: TestServer;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await ctx.server.close();
  await ctx.core.close();
});

function connect(id: string, headers: Record<string, string> = {}): WebSocket {
  const { host: _host, ...base } = ctx.headers;
  const socket = new WebSocket(`ws://127.0.0.1:${ctx.server.port}${terminalStreamPath(id)}`, {
    headers: { ...base, ...headers },
  });
  sockets.push(socket);
  return socket;
}

interface Message {
  readonly binary: boolean;
  readonly text: string;
}

function collect(socket: WebSocket) {
  const messages: Message[] = [];
  const waiters: Array<() => void> = [];
  socket.on("message", (data, binary) => {
    messages.push({ binary, text: data.toString() });
    for (const waiter of waiters.splice(0)) waiter();
  });
  const until = async (done: (all: Message[]) => boolean) => {
    while (!done(messages)) await new Promise<void>((resolve) => waiters.push(resolve));
    return messages;
  };
  return { messages, until };
}

const closed = (socket: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) =>
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })),
  );

const rejectedStatus = (socket: WebSocket) =>
  new Promise<number>((resolve) => {
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.once("error", () => undefined);
  });

async function openTerminal(): Promise<string> {
  const project = (
    await ctx.request({ method: "POST", url: "/api/projects", payload: { path: "/Users/demo/project" } })
  ).json();
  const started = await ctx.request({
    method: "POST",
    url: "/api/conversations",
    payload: { projectId: project.id, text: "hi", requestId: "term-start" },
  });
  const opened = await ctx.request({
    method: "POST",
    url: `/api/conversations/${started.json().id}/terminals`,
    payload: { cols: 80, rows: 24 },
  });
  return opened.json().id;
}

describe("terminal REST routes", () => {
  it("opens, lists, reports availability and closes", async () => {
    ctx = await startTestServer();
    expect((await ctx.request({ url: "/api/terminals/available" })).json()).toEqual({ available: true });
    const id = await openTerminal();
    const conversationId = (await ctx.request({ url: "/api/conversations" })).json()[0]?.id;
    const listed = await ctx.request({ url: `/api/conversations/${conversationId}/terminals` });
    expect(listed.json().map((terminal: { id: string }) => terminal.id)).toEqual([id]);
    expect((await ctx.request({ method: "DELETE", url: `/api/terminals/${id}` })).statusCode).toBe(204);
  });

  it("answers not_found for an unknown thread and 400 for a bad size", async () => {
    ctx = await startTestServer();
    expect((await ctx.request({ url: "/api/conversations/nope/terminals" })).statusCode).toBe(404);
    const bad = await ctx.request({
      method: "POST",
      url: "/api/conversations/nope/terminals",
      payload: { cols: 0, rows: 24 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("reports unavailable", async () => {
    ctx = await startTestServer({ fake: { terminals: false } });
    expect((await ctx.request({ url: "/api/terminals/available" })).json()).toEqual({ available: false });
  });
});

describe("terminal stream", () => {
  it("sends ready, replay, live output, then exit, in order", async () => {
    ctx = await startTestServer();
    const id = await openTerminal();
    const socket = connect(id);
    const { until } = collect(socket);
    await new Promise((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
    socket.send(Buffer.from("echo hi\r"));
    const seen = await until((all) =>
      all
        .map((m) => m.text)
        .join("")
        .includes("hi\r\n$ "),
    );
    expect(JSON.parse(seen[0]?.text ?? "")).toEqual({ type: "ready", status: "running", exitCode: null });
    expect(seen[1]?.binary).toBe(true);
    expect(seen[1]?.text.startsWith("$ ")).toBe(true);
    socket.send(Buffer.from("exit\r"));
    const all = await until((frames) => frames.at(-1)?.binary === false && frames.length > 2);
    expect(JSON.parse(all.at(-1)?.text ?? "")).toEqual({ type: "exit", exitCode: 0 });
  });

  it("attaching to an ended terminal sends ready (exited), the replay, exit, then closes", async () => {
    ctx = await startTestServer();
    const id = await openTerminal();
    const first = connect(id);
    const firstFrames = collect(first);
    await new Promise((resolve) => first.once("open", resolve));
    first.send(Buffer.from("exit\r"));
    await firstFrames.until((all) => all.at(-1)?.binary === false && all.length > 2);
    const late = connect(id);
    const lateFrames = collect(late);
    const done = closed(late);
    expect((await done).code).toBe(1000);
    const texts = lateFrames.messages.filter((message) => !message.binary).map((m) => JSON.parse(m.text));
    expect(texts).toEqual([
      { type: "ready", status: "exited", exitCode: 0 },
      { type: "exit", exitCode: 0 },
    ]);
    expect(lateFrames.messages[0]?.binary).toBe(false);
    expect(lateFrames.messages.at(-1)?.binary).toBe(false);
  });

  it("replays to a second attachment", async () => {
    ctx = await startTestServer();
    const id = await openTerminal();
    const first = connect(id);
    await new Promise((resolve) => first.once("open", resolve));
    first.send(Buffer.from("echo again\r"));
    await collect(first).until((all) =>
      all
        .map((m) => m.text)
        .join("")
        .includes("again"),
    );
    const second = collect(connect(id));
    const seen = await second.until((all) =>
      all
        .map((m) => m.text)
        .join("")
        .includes("again"),
    );
    expect(seen[0]?.binary).toBe(false);
  });

  it("closes 1008 not_found for an unknown id", async () => {
    ctx = await startTestServer();
    const socket = connect("missing");
    expect(await closed(socket)).toEqual({ code: 1008, reason: "not_found" });
  });

  it("closes 1008 for an invalid resize", async () => {
    ctx = await startTestServer();
    const socket = connect(await openTerminal());
    await new Promise((resolve) => socket.once("open", resolve));
    const done = closed(socket);
    socket.send(JSON.stringify({ type: "resize", cols: 501, rows: 24 }));
    expect((await done).code).toBe(1008);
  });

  it("closes 1008 for text that is not a frame", async () => {
    ctx = await startTestServer();
    const socket = connect(await openTerminal());
    await new Promise((resolve) => socket.once("open", resolve));
    const done = closed(socket);
    socket.send("hello");
    expect((await done).code).toBe(1008);
  });

  it("closes 1009 for an input frame above 64 KB", async () => {
    ctx = await startTestServer();
    const socket = connect(await openTerminal());
    await new Promise((resolve) => socket.once("open", resolve));
    const done = closed(socket);
    socket.send(Buffer.alloc(TERMINAL_STREAM_MAX_INPUT_BYTES + 1, 97));
    expect((await done).code).toBe(1009);
  });
});

describe("terminal stream security", () => {
  it("refuses an upgrade with a foreign Origin, a foreign Host or no cookie", async () => {
    ctx = await startTestServer();
    const id = await openTerminal();
    expect(await rejectedStatus(connect(id, { origin: "http://evil.example" }))).toBe(403);
    expect(await rejectedStatus(connect(id, { Host: "evil.example" }))).toBe(403);
    expect(await rejectedStatus(connect(id, { cookie: "" }))).toBe(401);
    expect(await rejectedStatus(connect(id, { cookie: `tau_${ctx.server.port}=wrong` }))).toBe(401);
  });
});
