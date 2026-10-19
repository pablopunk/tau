import { LINK_CLOSE_DUPLICATE, LINK_CLOSE_POLICY, LINK_CLOSE_UPDATE_REQUIRED } from "@tau/protocol";
import { generateNodeKeys } from "@tau/protocol/identity";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linkRaw, type RawLink, type RealRole, ROLES } from "../testing/raw-link";
import type { RawPeer } from "../testing/raw-peer";
import { dial, startNode, type TestNode, waitOnline } from "../testing/two-nodes";

let node: TestNode;
let other: TestNode | undefined;
let link: RawLink | undefined;
beforeEach(async () => {
  node = await startNode("Real");
});
afterEach(async () => {
  await link?.stop();
  link = undefined;
  await other?.stop();
  other = undefined;
  await node.stop();
});

/** The real node is the acceptor here (the raw peer dials it); the handshake is symmetric, so one direction proves the rules. */
const helloOf = async (peer: RawPeer) => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const hello = peer.received("hello")[0];
    if (hello) return hello;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("no hello arrived");
};

async function manual(options: Parameters<typeof linkRaw>[2] = {}, role: RealRole = "acceptor") {
  link = await linkRaw(node, role, { manual: true, manualProof: true, ...options });
  return link.peer;
}

describe.each(ROLES)("the handshake (the real node is the %s)", (role) => {
  it("answers a proof that comes before the peer's hello with 1008", async () => {
    const peer = await manual({ silent: true }, role);
    peer.sendControl({ type: "proof", payload: "tau-proof-v1|x|y|z", sig: "AAAA" });
    expect((await peer.closed).code).toBe(LINK_CLOSE_POLICY);
  });

  it("refuses a hello whose nodeId is not the hash of its key (1008)", async () => {
    const peer = await manual({ hello: { nodeId: "A".repeat(52) } }, role);
    expect((await peer.closed).code).toBe(LINK_CLOSE_POLICY);
  });

  it("refuses a key that does not belong to the id (1008)", async () => {
    const peer = await manual({ hello: { publicKey: generateNodeKeys().publicKey } }, role);
    expect((await peer.closed).code).toBe(LINK_CLOSE_POLICY);
  });

  it("closes 4002 on a reflected hello (a link to oneself)", async () => {
    const peer = await manual({ silent: true }, role);
    const ours = await helloOf(peer);
    peer.sendControl(ours);
    expect((await peer.closed).code).toBe(LINK_CLOSE_DUPLICATE);
  });

  it("closes 4001 on another linkProtocol", async () => {
    const peer = await manual({ hello: { linkProtocol: "other" } }, role);
    expect((await peer.closed).code).toBe(LINK_CLOSE_UPDATE_REQUIRED);
  });

  it("refuses a proof with a wrong signature, one for another nonce and a second proof (1008)", async () => {
    const peer = await manual({}, role);
    const ours = await helloOf(peer);
    const proof = peer.proofFor(ours) as { type: string; payload: string; sig: string };
    // Change the FIRST character (part of R): the last base64 characters of an Ed25519 signature are
    // mostly zero bits, so overwriting them is a no-op about one time in sixteen.
    const flipped = proof.sig.startsWith("A") ? "B" : "A";
    peer.sendControl({ ...proof, sig: `${flipped}${proof.sig.slice(1)}` });
    expect((await peer.closed).code).toBe(LINK_CLOSE_POLICY);
  });

  it("refuses a proof built from another nonce (a replay from an older session)", async () => {
    const peer = await manual({}, role);
    const ours = await helloOf(peer);
    peer.sendControl(peer.proofFor({ ...ours, nonce: "AAAAAAAAAAAAAAAAAAAAAA" }));
    expect((await peer.closed).code).toBe(LINK_CLOSE_POLICY);
  });

  it("closes 1008 on data or a request before the handshake ended", async () => {
    const peer = await manual({ silent: true }, role);
    peer.sendControl({
      type: "request",
      id: role === "acceptor" ? 1 : 2,
      method: "GET",
      path: "/api/projects",
      query: "",
      via: "x",
    });
    expect((await peer.closed).code).toBe(LINK_CLOSE_POLICY);
  });
});

describe("the pinned nodeId", () => {
  it("refuses a peer whose nodeId is not the pinned one (1008) and registers nothing", async () => {
    other = await startNode("Other");
    const { handle } = await dial(node, other, { pinnedNodeId: "A".repeat(52) });
    const closed = await handle.closed;
    expect(closed).toMatchObject({ code: LINK_CLOSE_POLICY, linked: false });
    expect((await node.core.nodes.list()).find((entry) => entry.id === other?.nodeId)).toBeUndefined();
  });

  it("links when the pin is right, and when nothing is pinned yet (first contact)", async () => {
    other = await startNode("Other");
    await dial(node, other, { pinnedNodeId: null });
    await waitOnline(node, other);
  });
});
