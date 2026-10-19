import { encodeFrame, LIVE_PATH, terminalStreamPath } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { linkNodes, startNode, type TestNode, viaNode } from "../testing/two-nodes";

let a: TestNode;
let b: TestNode;
const browsers: WebSocket[] = [];
beforeEach(async () => {
  a = await startNode("Alpha");
  b = await startNode("Bravo");
});
afterEach(async () => {
  for (const browser of browsers.splice(0)) browser.terminate();
  await a.stop();
  await b.stop();
});

const DIRECTIONS = ["dialler to acceptor", "acceptor to dialler"] as const;
/** `a` dials `b`: the first direction asks from `a`, the second from `b`. */
const ends = (direction: string): { from: TestNode; to: TestNode } =>
  direction === DIRECTIONS[0] ? { from: a, to: b } : { from: b, to: a };

function dialBrowser(host: TestNode, path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${host.ctx.server.port}${path}`, {
      headers: host.ctx.headers,
    });
    browsers.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}
const messages = (socket: WebSocket) => {
  const got: Array<{ data: Buffer; isBinary: boolean }> = [];
  socket.on("message", (data, isBinary) => got.push({ data: data as Buffer, isBinary }));
  return got;
};

describe("two real servers, one link (a dials b)", () => {
  it("lists each other online with the verified node id", async () => {
    await linkNodes(a, b);
    for (const [host, peer] of [
      [a, b],
      [b, a],
    ] as const) {
      const node = (await host.core.nodes.list()).find((entry) => entry.id === peer.nodeId);
      expect(node).toMatchObject({ name: peer.name, status: "online", identified: true });
    }
  });

  describe.each(DIRECTIONS)("requests %s", (direction) => {
    it("answers GETs through /api/n/<nodeId> from the real routes of the other node", async () => {
      const { from, to } = ends(direction);
      await linkNodes(a, b);
      await to.ctx.request({
        method: "POST",
        url: "/api/projects",
        payload: { path: "/Users/demo/project" },
      });
      const response = await from.ctx.request({ url: viaNode(to, "/api/projects") });
      expect(response.statusCode).toBe(200);
      const paths = (list: Array<{ path: string }>) => list.map((project) => project.path);
      expect(paths(response.json())).toEqual(paths((await to.ctx.request({ url: "/api/projects" })).json()));
      expect(paths(response.json())).toContain("/Users/demo/project");
      expect(paths((await from.ctx.request({ url: "/api/projects" })).json())).not.toContain(
        "/Users/demo/project",
      );
    });

    it("serves 20 parallel requests", async () => {
      const { from, to } = ends(direction);
      await linkNodes(a, b);
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => from.ctx.request({ url: viaNode(to, "/api/projects") })),
      );
      expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    });

    it("carries a 40 MB body to the real route (its validation answers, the stream never stalls)", async () => {
      const { from, to } = ends(direction);
      await linkNodes(a, b);
      const started = Date.now();
      const response = await from.ctx.request({
        method: "POST",
        url: viaNode(to, "/api/conversations/c1/messages"),
        payload: Buffer.alloc(40 * 1024 * 1024, 99),
        headers: { "content-type": "application/json" },
      });
      expect([400, 404, 415]).toContain(response.statusCode);
      expect(Date.now() - started).toBeLessThan(15_000);
    });

    it("pipes /live as text and a terminal stream as it comes", async () => {
      const { from, to } = ends(direction);
      await linkNodes(a, b);
      const project = (
        await to.ctx.request({
          method: "POST",
          url: "/api/projects",
          payload: { path: "/Users/demo/project" },
        })
      ).json();
      const started = await to.ctx.request({
        method: "POST",
        url: "/api/conversations",
        payload: { projectId: project.id, text: "hi", requestId: "r1" },
      });
      const conversationId = started.json().id;
      const live = await dialBrowser(from, `/api/n/${to.nodeId}${LIVE_PATH}`);
      const got = messages(live);
      live.send(encodeFrame({ type: "subscribe", conversationId }));
      await vi.waitFor(() => expect(got.length).toBeGreaterThan(0), { timeout: 5000 });
      expect(got[0]?.isBinary).toBe(false);
      const opened = await to.ctx.request({
        method: "POST",
        url: `/api/conversations/${conversationId}/terminals`,
        payload: { cols: 80, rows: 24 },
      });
      const terminal = await dialBrowser(from, `/api/n/${to.nodeId}${terminalStreamPath(opened.json().id)}`);
      const output = messages(terminal);
      terminal.send(Buffer.from("echo hi\r"));
      await vi.waitFor(() => expect(output.length).toBeGreaterThan(0), { timeout: 5000 });
    });
  });
});
