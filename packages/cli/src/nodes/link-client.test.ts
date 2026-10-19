import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Core, LINK_CLOSE_UPDATE_REQUIRED, type NodeLinkReport, type RequestFrame } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHubFileStore, type HubFileStore } from "./hub-file";
import { type LinkClient, type LinkTuning, startLinkClientWith } from "./link-client";
import { bodyOf, startTestHub, type TestHub } from "./link-test-hub";
import { MASTER, sha256, startTestNode, type TestNode } from "./link-test-node";

const SECRET = "s".repeat(43);
const logs: string[] = [];
const tuning: LinkTuning = {
  pollMs: 20,
  backoffBaseMs: 20,
  backoffMaxMs: 80,
  unreachableAfter: 3,
  pingMs: 100,
  log: (message) => void logs.push(message),
};

let hub: TestHub;
let node: TestNode;
let hubFile: HubFileStore;
let client: LinkClient | undefined;
let states: Array<NodeLinkReport & { peerId: string }>;

const fakeCore = (): Core =>
  ({
    nodes: { reportLink: (peerId: string, state: NodeLinkReport) => void states.push({ peerId, ...state }) },
    conversations: { listAll: async () => [{}, {}] },
  }) as unknown as Core;

const request = (id: number, path: string, extra: Partial<RequestFrame> = {}): RequestFrame => ({
  type: "request",
  id,
  method: "GET",
  path,
  query: "",
  via: "Phone",
  ...extra,
});

const start = () => {
  client = startLinkClientWith(
    {
      port: node.port,
      token: MASTER,
      hubFile,
      core: fakeCore(),
      attachPeer: (() => {
        throw new Error("legacy client does not use attachPeer");
      }) as never,
      peers: { read: async () => [], write: async () => undefined },
    },
    tuning,
  );
};
const statesNamed = () => states.map((state) => state.state);
const responseOf = (id: number) => hub.frames.find((frame) => frame.type === "response" && frame.id === id);

beforeEach(async () => {
  logs.length = 0;
  states = [];
  hub = await startTestHub();
  node = await startTestNode();
  hubFile = createHubFileStore(mkdtempSync(join(tmpdir(), "tau-link-")));
  await hubFile.write({ hubUrl: hub.url, nodeSecret: SECRET, name: "Home hub", nodeName: "Laptop" });
  start();
  await hub.socket();
  await hub.waitFor(() => hub.frames.some((frame) => frame.type === "hello"));
});

afterEach(async () => {
  await client?.stop();
  await hub.close();
  await node.close();
});

describe("link client", () => {
  it("dials with the node secret and the hub origin, then says hello", async () => {
    expect(hub.upgrades[0]?.authorization).toBe(`Bearer ${SECRET}`);
    expect(hub.upgrades[0]?.origin).toBe(hub.url);
    expect(hub.frames[0]).toMatchObject({ type: "hello", name: "Laptop", threadCount: 2 });
    await vi.waitFor(() => expect(statesNamed()).toContain("linked"));
    expect(states.at(-1)?.peerId).toMatch(/^u-[0-9a-f]{12}$/);
  });

  it("answers a request on loopback with the master token and the hub device", async () => {
    await hub.sendFrame(request(1, "/api/hello", { query: "a=1" }));
    await hub.waitFor(() => hub.ends.has(1));
    expect(responseOf(1)).toMatchObject({ status: 200 });
    expect(JSON.parse(bodyOf(hub, 1).toString())).toMatchObject({ url: "/api/hello?a=1", method: "GET" });
    const seen = node.seen[0];
    expect(seen?.authorization).toBe(`Bearer ${MASTER}`);
    expect(seen?.host).toBe(`127.0.0.1:${node.port}`);
    expect(seen?.origin).toBeUndefined();
    expect(seen?.["x-tau-via"]).toBe("Phone");
  });

  it("streams a 5 MB response in chunks of at most 256 KB", async () => {
    await hub.sendFrame(request(2, "/api/big"));
    await hub.waitFor(() => hub.ends.has(2), 15_000);
    expect(bodyOf(hub, 2).byteLength).toBe(5 * 1024 * 1024);
    expect(Math.max(...(hub.data.get(2) ?? []).map((chunk) => chunk.byteLength))).toBeLessThanOrEqual(
      256 * 1024,
    );
  });

  it("streams a 42 MB request body under credit", async () => {
    const body = Buffer.alloc(42 * 1024 * 1024, 9);
    await hub.sendFrame(
      request(3, "/api/upload", {
        method: "POST",
        bodyBytes: body.byteLength,
        contentType: "application/octet-stream",
      }),
    );
    await hub.sendBody(3, body);
    await hub.waitFor(() => hub.ends.has(3), 30_000);
    expect(JSON.parse(bodyOf(hub, 3).toString())).toMatchObject({
      bytes: body.byteLength,
      sha: sha256(body),
    });
  }, 60_000);

  it("serves parallel requests", async () => {
    for (let id = 10; id < 30; id++) await hub.sendFrame(request(id, `/api/p${id}`));
    await hub.waitFor(() => [...Array(20).keys()].every((n) => hub.ends.has(n + 10)));
    expect(JSON.parse(bodyOf(hub, 29).toString()).url).toBe("/api/p29");
  });

  it("answers 502 when its own server is down", async () => {
    await node.close();
    await hub.sendFrame(request(4, "/api/hello"));
    await hub.waitFor(() => hub.ends.has(4));
    expect(responseOf(4)).toMatchObject({ status: 502 });
  });

  it("queues hub frames until the loopback socket opens and relays text and binary both ways", async () => {
    await hub.sendFrame({ type: "open", id: 5, path: "/api/live", query: "", via: "Phone" });
    await hub.sendData(5, Buffer.from("hello"), true);
    await hub.sendData(5, Uint8Array.from([1, 2, 3, 255, 0, 9]), false);
    await hub.waitFor(() => (hub.data.get(5)?.length ?? 0) >= 2);
    expect(hub.data.get(5)?.[0]?.toString()).toBe("hello");
    expect(hub.textFlags.get(5)).toEqual([true, false]);
    expect([...(hub.data.get(5)?.[1] ?? [])]).toEqual([1, 2, 3, 255, 0, 9]);
    expect(node.socketHeaders[0]?.authorization).toBe(`Bearer ${MASTER}`);
    expect(node.socketHeaders[0]?.origin).toBeUndefined();
    expect(node.socketHeaders[0]?.["x-tau-via"]).toBe("Phone");
  });

  it("confirms an opened stream with an open frame so the hub releases its queued frames", async () => {
    await hub.sendFrame({ type: "open", id: 21, path: "/api/live", query: "x=1", via: "Phone" });
    await hub.waitFor(() => hub.frames.some((frame) => frame.type === "open" && frame.id === 21));
    await hub.sendFrame({ type: "close", id: 21, code: 1000, reason: "" });
  });

  it("splits binary input above 64 KB and refuses an oversize text frame", async () => {
    await hub.sendFrame({ type: "open", id: 6, path: "/api/live", query: "", via: "Phone" });
    await hub.sendData(6, Buffer.alloc(150 * 1024, 1), false);
    await hub.waitFor(() => node.received.length >= 3);
    expect(node.received.map((message) => message.size)).toEqual([65536, 65536, 150 * 1024 - 131072]);
    await hub.sendData(6, Buffer.alloc(100 * 1024, 97), true);
    await hub.waitFor(() => hub.frames.some((frame) => frame.type === "close" && frame.id === 6));
    expect(hub.frames.find((frame) => frame.type === "close")).toMatchObject({ code: 1009 });
  });

  it("stops sending when credit runs out and resumes on credit", async () => {
    hub.autoCredit = false;
    await hub.sendFrame({ type: "open", id: 7, path: "/api/flood", query: "", via: "Phone" });
    await hub.waitFor(() => bodyOf(hub, 7).byteLength >= 1024 * 1024);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const stalled = bodyOf(hub, 7).byteLength;
    expect(stalled).toBeLessThan(1024 * 1024 + 256 * 1024);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(bodyOf(hub, 7).byteLength).toBe(stalled);
    await hub.sendFrame({ type: "credit", id: 7, bytes: 512 * 1024 });
    await hub.waitFor(() => bodyOf(hub, 7).byteLength > stalled);
  });

  it("round-robins between streams that both have credit", async () => {
    hub.autoCredit = false;
    await hub.sendFrame(request(8, "/api/big"));
    await hub.sendFrame(request(9, "/api/big"));
    await hub.waitFor(
      () => bodyOf(hub, 8).byteLength >= 512 * 1024 && bodyOf(hub, 9).byteLength >= 512 * 1024,
    );
    await hub.sendFrame({ type: "close", id: 8, code: 1000, reason: "" });
    await hub.sendFrame({ type: "close", id: 9, code: 1000, reason: "" });
  });

  it("aborts in-flight streams when the hub closes the link and reconnects with backoff", async () => {
    hub.autoCredit = false;
    await hub.sendFrame(request(11, "/api/endless"));
    await hub.waitFor(() => bodyOf(hub, 11).byteLength > 0);
    (await hub.socket()).terminate();
    await vi.waitFor(() => expect(node.aborted).toContain("endless"));
    await hub.waitFor(() => hub.upgrades.length >= 2);
    await vi.waitFor(() => expect(statesNamed()).toContain("reconnecting"));
    await vi.waitFor(() => expect(statesNamed().at(-1)).toBe("linked"));
    expect(hub.frames.filter((frame) => frame.type === "hello")).toHaveLength(2);
  });

  it("reports unreachable after repeated failures", async () => {
    await client?.stop();
    await hub.close();
    states = [];
    start();
    await vi.waitFor(() => expect(statesNamed()).toContain("unreachable"), { timeout: 5000 });
  });

  it("reports refused and stops retrying when the hub answers 401", async () => {
    await client?.stop();
    hub.refuseWith = 401;
    states = [];
    const before = hub.upgrades.length;
    start();
    await vi.waitFor(() => expect(statesNamed()).toContain("refused"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(hub.upgrades.length).toBe(before + 1);
  });

  it("reports update-required when the hub closes with the update code", async () => {
    states = [];
    (await hub.socket()).close(LINK_CLOSE_UPDATE_REQUIRED, "update required");
    await vi.waitFor(() => expect(statesNamed()).toContain("update-required"));
    await vi.waitFor(() => expect(statesNamed().at(-1)).toBe("linked"), { timeout: 5000 });
  });

  it("drops the link when the peer is deleted and redials when it comes back", async () => {
    await hubFile.delete();
    await new Promise((resolve) => setTimeout(resolve, 300));
    states = [];
    await hubFile.write({ hubUrl: hub.url, nodeSecret: SECRET, name: "Home hub" });
    await vi.waitFor(() => expect(statesNamed().at(-1)).toBe("linked"));
  });

  it("never logs the node secret or the master token", async () => {
    await hub.sendFrame(request(12, "/api/hello"));
    await hub.waitFor(() => hub.ends.has(12));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain(MASTER);
  });
});
