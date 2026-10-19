import { encodeFrame, LIVE_PATH } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { viaNode } from "../../testing/two-nodes";
import { type Chain, startChain } from "./test-chain";

let chain: Chain;
const browsers: WebSocket[] = [];
beforeEach(async () => {
  chain = await startChain();
});
afterEach(async () => {
  for (const browser of browsers.splice(0)) browser.terminate();
  await chain.stop();
});

function dialBrowser(host: Chain["a"], path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${host.ctx.server.port}${path}`, {
      headers: host.ctx.headers,
    });
    browsers.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

describe("A reaches C through B", () => {
  it("answers a GET from the real routes of C, and 20 in parallel", async () => {
    const { a, c } = chain;
    await c.ctx.request({ method: "POST", url: "/api/projects", payload: { path: "/Users/demo/project" } });
    const response = await a.ctx.request({ url: viaNode(c, "/api/projects") });
    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json())).toContain("/Users/demo/project");
    const many = await Promise.all(
      Array.from({ length: 20 }, () => a.ctx.request({ url: viaNode(c, "/api/projects") })),
    );
    expect(many.every((each) => each.statusCode === 200)).toBe(true);
  });

  it("carries a 20 MB body to C (credit held hop by hop, nothing stalls)", async () => {
    const { a, c } = chain;
    const started = Date.now();
    const response = await a.ctx.request({
      method: "POST",
      url: viaNode(c, "/api/conversations/c1/messages"),
      payload: Buffer.alloc(20 * 1024 * 1024, 99),
      headers: { "content-type": "application/json" },
    });
    expect([400, 404, 415]).toContain(response.statusCode);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("pipes /live both ways with ready forwarded", async () => {
    const { a, c } = chain;
    const project = (
      await c.ctx.request({ method: "POST", url: "/api/projects", payload: { path: "/Users/demo/project" } })
    ).json();
    const started = await c.ctx.request({
      method: "POST",
      url: "/api/conversations",
      payload: { projectId: project.id, text: "hi", requestId: "r1" },
    });
    const live = await dialBrowser(a, `/api/n/${c.nodeId}${LIVE_PATH}`);
    const got: Buffer[] = [];
    live.on("message", (data) => got.push(data as Buffer));
    live.send(encodeFrame({ type: "subscribe", conversationId: started.json().id }));
    await vi.waitFor(() => expect(got.length).toBeGreaterThan(0), { timeout: 5000 });
  });

  it("refuses an origin that has no route (no_route is not_found while unreachable)", async () => {
    const { a, c } = chain;
    a.control.routes.clear();
    expect((await a.ctx.request({ url: viaNode(c, "/api/projects") })).statusCode).toBe(404);
  });

  it("answers no_route when the middle node has lost the route", async () => {
    const { a, b, c } = chain;
    b.control.routes.delete(c.nodeId);
    const response = await a.ctx.request({ url: viaNode(c, "/api/projects") });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("no_route");
  });

  it("refuses a denylisted path at the destination (the filter runs there too)", async () => {
    const { a, c } = chain;
    const response = await a.ctx.request({ url: viaNode(c, "/api/access/devices") });
    expect([403, 404]).toContain(response.statusCode);
  });
});

describe("tombstones and expels", () => {
  it("closes the stream at C and at B when the origin A is tombstoned", async () => {
    const { a, b, c } = chain;
    const live = await dialBrowser(a, `/api/n/${c.nodeId}${LIVE_PATH}`);
    const closed = new Promise<number>((resolve) => live.once("close", (code) => resolve(code)));
    live.send(encodeFrame({ type: "subscribe", conversationId: "none" }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    b.control.tombstone(a.nodeId);
    c.control.tombstone(a.nodeId);
    expect(await closed).toBeGreaterThanOrEqual(1000);
  });

  it("floods an expel to the target before it closes the link 4003", async () => {
    const { b, c } = chain;
    const order: string[] = [];
    const original = c.core.nodes.group.acceptExpel;
    c.core.nodes.group.acceptExpel = async (frame, from) => {
      order.push("expel");
      return original(frame, from);
    };
    const gone = new Promise<void>((resolve) => {
      const timer = setInterval(async () => {
        const nodes = await c.core.nodes.list();
        if (nodes.find((node) => node.id === b.nodeId)?.status !== "online") {
          clearInterval(timer);
          order.push("closed");
          resolve();
        }
      }, 20);
    });
    const response = await b.ctx.request({
      method: "POST",
      url: `/api/nodes/${c.nodeId}/remove`,
      payload: { confirm: "Charlie" },
    });
    expect(response.statusCode).toBeLessThan(300);
    await gone;
    expect(order).toEqual(["expel", "closed"]);
  });

  it("cuts every link when this node learns it was expelled", async () => {
    const { a, b, c } = chain;
    const statusOf = async (id: string) => (await b.core.nodes.list()).find((node) => node.id === id)?.status;
    await vi.waitFor(async () => expect(await statusOf(c.nodeId)).toBe("online"));
    c.control.expelSelfNext();
    const response = await b.ctx.request({
      method: "POST",
      url: `/api/nodes/${a.nodeId}/remove`,
      payload: { confirm: "Alpha" },
    });
    expect(response.statusCode).toBeLessThan(300);
    await vi.waitFor(async () => expect(await statusOf(c.nodeId)).not.toBe("online"));
  });
});
