import { LINK_CLOSE_DUPLICATE, LINK_CLOSE_GOING_AWAY, LIVE_PATH } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  dial,
  linkNodes,
  startNode,
  type TestNode,
  viaNode,
  waitOffline,
  waitOnline,
} from "../testing/two-nodes";

let a: TestNode;
let b: TestNode;
const browsers: WebSocket[] = [];
beforeEach(async () => {
  a = await startNode("Alpha");
  b = await startNode("Bravo");
});
afterEach(async () => {
  vi.useRealTimers();
  for (const browser of browsers.splice(0)) browser.terminate();
  await a.stop();
  await b.stop();
});

const nodeDevices = async (host: TestNode) =>
  (await host.core.access.listDevices()).filter((device) => device.kind === "node");
const dialBrowser = (host: TestNode, path: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${host.ctx.server.port}${path}`, {
      headers: host.ctx.headers,
    });
    browsers.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
const closeOf = (socket: WebSocket) => new Promise<number>((resolve) => socket.once("close", resolve));
const works = async (from: TestNode, to: TestNode) =>
  (await from.ctx.request({ url: viaNode(to, "/api/projects") })).statusCode === 200;

describe("glare: both nodes dial each other at once", () => {
  it("keeps exactly the link whose dialler has the lower nodeId, closes the other 4002 on both ends and revokes nothing", async () => {
    const [toB, toA] = await Promise.all([dial(a, b), dial(b, a)]);
    const aWins = a.nodeId < b.nodeId;
    const [winner, loser] = aWins ? [toB, toA] : [toA, toB];
    expect((await loser.handle.closed).code).toBe(LINK_CLOSE_DUPLICATE);
    await vi.waitFor(async () => expect(await works(a, b)).toBe(true));
    expect(await works(b, a)).toBe(true);
    expect(winner.socket.readyState).toBe(WebSocket.OPEN);
    expect(await nodeDevices(a)).toHaveLength(1);
    expect(await nodeDevices(b)).toHaveLength(1);
    expect((await loser.handle.closed).bye).toBe(false);
  });

  it("recovers from the standby secret when the surviving link drops", async () => {
    const [toB, toA] = await Promise.all([dial(a, b), dial(b, a)]);
    const aWins = a.nodeId < b.nodeId;
    const [winner, loser] = aWins ? [toB, toA] : [toA, toB];
    await loser.handle.closed;
    winner.handle.close(1000, "test drop");
    await winner.handle.closed;
    const [from, to] = aWins ? [b, a] : [a, b];
    await dial(from, to, { secret: loser.secret, deviceId: loser.deviceId });
    await vi.waitFor(async () => expect(await works(a, b)).toBe(true));
    expect(await works(b, a)).toBe(true);
  });
});

describe("a second link to the same nodeId", () => {
  it("keeps the established link when another device (a second tau connect) dials, closes the new one 4002 and revokes its device", async () => {
    const first = await linkNodes(a, b);
    const second = await dial(a, b, { peerId: "u-second" });
    expect((await second.handle.closed).code).toBe(LINK_CLOSE_DUPLICATE);
    expect(first.socket.readyState).toBe(WebSocket.OPEN);
    await vi.waitFor(async () =>
      expect((await nodeDevices(b)).map((device) => device.id)).toEqual([first.deviceId]),
    );
    expect(await works(a, b)).toBe(true);
  });

  it("replaces a link that has been silent for more than 15 s (repair by connecting again) and revokes the old device", async () => {
    const first = await linkNodes(a, b);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 20_000);
    const second = await dial(a, b, { peerId: "u-repair" });
    expect((await first.handle.closed).code).toBe(LINK_CLOSE_GOING_AWAY);
    vi.useRealTimers();
    await waitOnline(b, a);
    expect(second.socket.readyState).toBe(WebSocket.OPEN);
    await vi.waitFor(async () =>
      expect((await nodeDevices(b)).map((device) => device.id)).toEqual([second.deviceId]),
    );
  });

  it("replaces the older link with 1001 on a reconnect with the same device secret, keeping the device", async () => {
    const first = await linkNodes(a, b);
    const again = await dial(a, b, { secret: first.secret, deviceId: first.deviceId });
    expect((await first.handle.closed).code).toBe(LINK_CLOSE_GOING_AWAY);
    await vi.waitFor(async () => expect(await works(a, b)).toBe(true));
    expect(again.socket.readyState).toBe(WebSocket.OPEN);
    expect(await nodeDevices(b)).toHaveLength(1);
    expect((await b.core.nodes.list()).find((node) => node.id === a.nodeId)?.status).toBe("online");
  });

  it("stops after three replacements in a minute: the next link is refused 4002 (duplicate identity)", async () => {
    const first = await linkNodes(a, b);
    for (let round = 0; round < 3; round++) {
      await dial(a, b, { secret: first.secret, deviceId: first.deviceId });
      await vi.waitFor(async () => expect(await works(a, b)).toBe(true));
    }
    const refused = await dial(a, b, { secret: first.secret, deviceId: first.deviceId });
    expect((await refused.handle.closed).code).toBe(LINK_CLOSE_DUPLICATE);
    expect(await works(a, b)).toBe(true);
  });
});

describe("revoke, disconnect and forget", () => {
  it("disconnect on the acceptor sends bye and closes the link and every proxied stream on both sides", async () => {
    const link = await linkNodes(a, b);
    const onA = await dialBrowser(a, `/api/n/${b.nodeId}${LIVE_PATH}`);
    const onB = await dialBrowser(b, `/api/n/${a.nodeId}${LIVE_PATH}`);
    const [closedA, closedB] = [closeOf(onA), closeOf(onB)];
    expect((await b.ctx.request({ method: "DELETE", url: `/api/nodes/${a.nodeId}` })).statusCode).toBe(204);
    expect(await closedB).toBe(1008);
    expect(await closedA).toBe(1013);
    const ended = await link.handle.closed;
    expect(ended.bye).toBe(true);
    expect(ended.reason).toBe("disconnect");
    await vi.waitFor(async () =>
      expect((await a.core.nodes.list()).find((node) => node.id === b.nodeId)?.status).toBe("offline"),
    );
    expect(await nodeDevices(b)).toHaveLength(0);
    expect((await a.ctx.request({ url: viaNode(b, "/api/projects") })).statusCode).toBe(404);
  });

  it("a revoked device closes its link with bye, and the dialler does not retry", async () => {
    const link = await linkNodes(a, b);
    expect(
      (await b.ctx.request({ method: "DELETE", url: `/api/access/devices/${link.deviceId}` })).statusCode,
    ).toBe(204);
    const ended = await link.handle.closed;
    expect(ended).toMatchObject({ bye: true, code: 1008, linked: true });
    await waitOffline(a, b);
  });

  it("the dialler's disconnect makes the acceptor revoke the node device", async () => {
    const link = await linkNodes(a, b);
    expect((await a.ctx.request({ method: "DELETE", url: `/api/nodes/${b.nodeId}` })).statusCode).toBe(204);
    await link.handle.closed;
    await vi.waitFor(async () => expect(await nodeDevices(b)).toHaveLength(0));
    expect((await b.core.nodes.list()).find((node) => node.id === a.nodeId)).toBeUndefined();
  });

  it("forget sends bye and closes both sides, but the other node keeps its device and shows the peer offline", async () => {
    const link = await linkNodes(a, b);
    expect((await a.ctx.request({ method: "POST", url: `/api/nodes/${b.nodeId}/forget` })).statusCode).toBe(
      204,
    );
    expect((await link.handle.closed).bye).toBe(false);
    await waitOffline(b, a);
    expect(await nodeDevices(b)).toHaveLength(1);
  });
});
