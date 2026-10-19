import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import type { Peer, PeersStore } from "@tau/core";
import type { Core, NodeLinkReport } from "@tau/protocol";
import {
  LINK_CLOSE_DUPLICATE,
  LINK_CLOSE_POLICY,
  LINK_CLOSE_REMOVED,
  LINK_CLOSE_UPDATE_REQUIRED,
} from "@tau/protocol";
import type { AttachPeer, PeerClosed, PeerHandle, PeerInfo } from "@tau/server";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { type LinkClient, type LinkTuning, startLinkClientWith } from "./link-client";
import { secretKeyOf } from "./peer-dialler";

const SECRET = "s".repeat(43);
const logs: string[] = [];
const tuning: LinkTuning = {
  pollMs: 15,
  backoffBaseMs: 15,
  backoffMaxMs: 60,
  standbyMs: 40,
  unreachableAfter: 3,
  log: (message) => void logs.push(message),
};

interface FakeHub {
  readonly url: string;
  readonly headers: IncomingHttpHeaders[];
  close(): Promise<void>;
}

const hubs: FakeHub[] = [];

function closeServer(server: WebSocketServer): Promise<void> {
  for (const socket of server.clients) socket.terminate();
  return new Promise((resolve) => void server.close(() => resolve()));
}
let client: LinkClient | undefined;

async function startHub(): Promise<FakeHub> {
  const headers: IncomingHttpHeaders[] = [];
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  server.on("connection", (_socket, request) => void headers.push(request.headers));
  await new Promise((resolve) => server.once("listening", resolve));
  const hub = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    headers,
    close: () => closeServer(server),
  };
  hubs.push(hub);
  return hub;
}

/** A hub that answers every upgrade with an HTTP status. */
async function startRefusingHub(status: number): Promise<FakeHub> {
  const headers: IncomingHttpHeaders[] = [];
  const server = new WebSocketServer({
    port: 0,
    host: "127.0.0.1",
    verifyClient: (info, done) => {
      headers.push(info.req.headers);
      done(false, status);
    },
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const hub = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    headers,
    close: () => closeServer(server),
  };
  hubs.push(hub);
  return hub;
}

interface Attached {
  readonly info: PeerInfo;
  readonly closeWith: (closed: Partial<PeerClosed>) => void;
  closeCalls: number;
}

function fakeAttach(): { attachPeer: AttachPeer; attached: Attached[] } {
  const attached: Attached[] = [];
  const attachPeer: AttachPeer = (_socket, role, info) => {
    expect(role).toBe("dialler");
    let resolve!: (closed: PeerClosed) => void;
    const closed = new Promise<PeerClosed>((done) => {
      resolve = done;
    });
    const entry: Attached = {
      info,
      closeCalls: 0,
      closeWith: (value) => resolve({ code: 1006, reason: "", linked: true, bye: false, ...value }),
    };
    attached.push(entry);
    const handle: PeerHandle = {
      closed,
      close: () => {
        entry.closeCalls++;
        entry.closeWith({ code: 1000 });
      },
    };
    return handle;
  };
  return { attachPeer, attached };
}

function memoryPeers(initial: Peer[]): PeersStore & { set(next: Peer[]): void } {
  let current = initial;
  return {
    read: async () => current,
    write: async (next) => {
      current = [...next];
    },
    set: (next) => {
      current = next;
    },
  };
}

interface Reported extends NodeLinkReport {
  peerId: string;
}

function setup(peers: PeersStore, attachPeer: AttachPeer, nodes: unknown[] = []) {
  const reports: Reported[] = [];
  const core = {
    nodes: {
      reportLink: (peerId: string, state: NodeLinkReport) => void reports.push({ peerId, ...state }),
      list: async () => nodes,
    },
  } as unknown as Core;
  client = startLinkClientWith({ attachPeer, peers, core }, tuning);
  return {
    reports,
    states: (peerId?: string) => reports.filter((r) => !peerId || r.peerId === peerId).map((r) => r.state),
  };
}

const waitFor = async (condition: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

const peerAt = (hub: FakeHub, extra: Partial<Peer> = {}): Peer => ({
  url: hub.url,
  name: "Peer",
  secret: SECRET,
  nodeId: "n-aaa",
  ...extra,
});

afterEach(async () => {
  await client?.stop();
  client = undefined;
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
});

describe("multi-peer dialler", () => {
  it("dials every entry with its secret and origin and attaches it pinned", async () => {
    const [a, b] = [await startHub(), await startHub()];
    const { attachPeer, attached } = fakeAttach();
    const peers = memoryPeers([peerAt(a), peerAt(b, { nodeId: "n-bbb", secret: "t".repeat(43) })]);
    const { states } = setup(peers, attachPeer);
    await waitFor(() => attached.length === 2);
    expect(a.headers[0]?.authorization).toBe(`Bearer ${SECRET}`);
    expect(a.headers[0]?.origin).toBe(new URL(a.url).origin);
    expect(attached.map((entry) => entry.info)).toEqual([
      { peerId: "n-aaa", pinnedNodeId: "n-aaa", secretKey: secretKeyOf(SECRET) },
      { peerId: "n-bbb", pinnedNodeId: "n-bbb", secretKey: secretKeyOf("t".repeat(43)) },
    ]);
    expect(states("n-aaa")).toEqual(["connecting", "linked"]);
  });

  it("picks up a new entry without a restart and closes the link of a removed one", async () => {
    const [a, b] = [await startHub(), await startHub()];
    const { attachPeer, attached } = fakeAttach();
    const peers = memoryPeers([peerAt(a)]);
    setup(peers, attachPeer);
    await waitFor(() => attached.length === 1);
    peers.set([peerAt(a), peerAt(b, { nodeId: "n-bbb" })]);
    await waitFor(() => attached.length === 2);
    peers.set([peerAt(b, { nodeId: "n-bbb" })]);
    await waitFor(() => attached[0]?.closeCalls === 1);
    expect(attached[1]?.closeCalls).toBe(0);
  });

  it("learns the node id without redialling", async () => {
    const a = await startHub();
    const { attachPeer, attached } = fakeAttach();
    const peers = memoryPeers([peerAt(a, { nodeId: undefined })]);
    const { states } = setup(peers, attachPeer);
    await waitFor(() => attached.length === 1);
    expect(attached[0]?.info.pinnedNodeId).toBeUndefined();
    peers.set([peerAt(a)]);
    await settle();
    attached[0]?.closeWith({ code: 1006 });
    await waitFor(() => attached.length === 2);
    expect(attached[1]?.info.peerId).toBe("n-aaa");
    expect(states("n-aaa")).toContain("reconnecting");
  });

  it("retries a dropped link with a backoff, then reports unreachable after three failures", async () => {
    const a = await startHub();
    const { attachPeer, attached } = fakeAttach();
    const { states } = setup(memoryPeers([peerAt(a)]), attachPeer);
    await waitFor(() => attached.length === 1);
    await a.close();
    attached[0]?.closeWith({ code: 1006 });
    await waitFor(() => states("n-aaa").includes("unreachable"));
    expect(states("n-aaa").slice(0, 4)).toEqual(["connecting", "linked", "reconnecting", "reconnecting"]);
  });

  it.each([
    ["4002 duplicate", { code: LINK_CLOSE_DUPLICATE }, "duplicate"],
    ["4003 removed", { code: LINK_CLOSE_REMOVED }, "refused"],
    ["1008 policy (pinned id mismatch)", { code: LINK_CLOSE_POLICY }, "refused"],
    ["bye", { code: 1000, bye: true }, "refused"],
  ] as const)("does not retry after %s", async (_name, closed, state) => {
    const a = await startHub();
    const { attachPeer, attached } = fakeAttach();
    const { states } = setup(memoryPeers([peerAt(a)]), attachPeer);
    await waitFor(() => attached.length === 1);
    attached[0]?.closeWith(closed);
    await waitFor(() => states("n-aaa").includes(state));
    await settle();
    expect(attached).toHaveLength(1);
    expect(a.headers).toHaveLength(1);
  });

  it("reports update-required on 4001 and keeps trying", async () => {
    const a = await startHub();
    const { attachPeer, attached } = fakeAttach();
    const { states } = setup(memoryPeers([peerAt(a)]), attachPeer);
    await waitFor(() => attached.length === 1);
    attached[0]?.closeWith({ code: LINK_CLOSE_UPDATE_REQUIRED });
    await waitFor(() => attached.length === 2);
    expect(states("n-aaa")).toContain("update-required");
  });

  it.each([401, 403])("stops on an HTTP %s as refused", async (status) => {
    const hub = await startRefusingHub(status);
    const { attachPeer, attached } = fakeAttach();
    const { states } = setup(memoryPeers([peerAt(hub)]), attachPeer);
    await waitFor(() => states("n-aaa").includes("refused"));
    await settle();
    expect(hub.headers).toHaveLength(1);
    expect(attached).toHaveLength(0);
  });

  it("dials again after peers.json changes the secret of a refused peer", async () => {
    const hub = await startRefusingHub(401);
    const { attachPeer } = fakeAttach();
    const peers = memoryPeers([peerAt(hub)]);
    setup(peers, attachPeer);
    await waitFor(() => hub.headers.length === 1);
    peers.set([peerAt(hub, { secret: "u".repeat(43) })]);
    await waitFor(() => hub.headers.length === 2);
    expect(hub.headers[1]?.authorization).toBe(`Bearer ${"u".repeat(43)}`);
  });

  it("keeps a standby (same node, another link alive) off the wire and retries it", async () => {
    const [a, b] = [await startHub(), await startHub()];
    const { attachPeer, attached } = fakeAttach();
    const nodes = [{ id: "n-aaa", links: [{ direction: "accepted", state: "linked" }] }];
    const { states } = setup(
      memoryPeers([peerAt(a), peerAt(b, { secret: "t".repeat(43) })]),
      attachPeer,
      nodes,
    );
    await waitFor(() => states("n-aaa").filter((state) => state === "standby").length >= 2);
    expect(attached).toHaveLength(0);
    expect(a.headers).toHaveLength(0);
  });

  it("stops before returning: handles are closed and nothing is redialled", async () => {
    const a = await startHub();
    const { attachPeer, attached } = fakeAttach();
    setup(memoryPeers([peerAt(a)]), attachPeer);
    await waitFor(() => attached.length === 1);
    await client?.stop();
    client = undefined;
    expect(attached[0]?.closeCalls).toBe(1);
    await settle();
    expect(attached).toHaveLength(1);
  });

  it("never writes a secret in the logs", async () => {
    const a = await startHub();
    const { attachPeer, attached } = fakeAttach();
    setup(memoryPeers([peerAt(a)]), attachPeer);
    await waitFor(() => attached.length === 1);
    expect(logs.join("\n")).not.toContain(SECRET);
  });
});
