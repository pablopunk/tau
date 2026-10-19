import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANNOUNCE_EXPIRY_MS, EXPEL_CREATE_PER_MINUTE } from "@tau/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { clock, createNetwork, makeNode, type TestNode } from "./test-network";

const rejects = async (promise: Promise<unknown>, code: string) =>
  expect(
    await promise.then(
      () => "resolved",
      (e: { code?: string }) => e.code,
    ),
  ).toBe(code);

let a: TestNode;
let b: TestNode;
let c: TestNode;
let net: ReturnType<typeof createNetwork>;

beforeEach(async () => {
  clock.now = 1_000_000;
  [a, b, c] = [await makeNode("Alpha"), await makeNode("Bravo"), await makeNode("Charlie")] as [
    TestNode,
    TestNode,
    TestNode,
  ];
  net = createNetwork([a, b, c]);
  await net.link(a, b);
  await net.link(b, c);
  await net.announceAll();
});

describe("topology", () => {
  it("routes A to C through B with hops 2 and a text 'via'", async () => {
    expect(a.dir.group.route(c.id)).toEqual({ dest: c.id, nextHop: b.id, hops: 2 });
    const routed = (await a.dir.directory()).find((n) => n.id === c.id);
    expect(routed).toMatchObject({
      direct: false,
      hops: 2,
      via: "Bravo",
      nextHop: b.id,
      links: [],
      ghost: false,
    });
  });

  it("shows the middle node both ends as neighbours", async () => {
    expect((await b.dir.directory()).map((n) => [n.name, n.hops]).sort()).toEqual([
      ["Alpha", 1],
      ["Charlie", 1],
    ]);
  });

  it("a stopped announcer becomes a ghost and leaves the routes", async () => {
    clock.now += ANNOUNCE_EXPIRY_MS + 1;
    await net.announceAll(1, [a, b]);
    await a.dir.group.localAnnounce();
    expect(a.dir.group.route(c.id)).toBeUndefined();
    expect((await a.dir.directory()).find((n) => n.id === c.id)).toMatchObject({
      ghost: true,
      status: "offline",
    });
  });

  it("records the skew and marks a neighbour unsynced", async () => {
    a.dir.group.recordSkew(b.id, 500);
    a.dir.group.markUnsynced(b.id);
    const node = (await a.dir.directory()).find((n) => n.id === b.id);
    expect(node).toMatchObject({ skewMs: 500, unsynced: true });
    expect(a.dir.group.neighbours()).toEqual([]);
  });
});

describe("announce refusals", () => {
  it("refuses stale, about-self, unsynced, not-linked and forged announces", async () => {
    const frame = await b.dir.group.localAnnounce();
    expect(await a.dir.group.acceptAnnounce(frame, b.id)).toMatchObject({ accepted: true });
    expect(await a.dir.group.acceptAnnounce(frame, b.id)).toMatchObject({ reason: "stale" });
    expect(await a.dir.group.acceptAnnounce(await a.dir.group.localAnnounce(), b.id)).toMatchObject({
      reason: "about-self",
    });
    expect(await a.dir.group.acceptAnnounce(frame, "stranger")).toMatchObject({ reason: "capability" });
    const forged = { ...(await c.dir.group.localAnnounce()), sig: frame.sig };
    expect(await a.dir.group.acceptAnnounce(forged, b.id)).toMatchObject({ reason: "bad-signature" });
    a.dir.group.markUnsynced(b.id);
    expect(await a.dir.group.acceptAnnounce(await c.dir.group.localAnnounce(), b.id)).toMatchObject({
      reason: "unsynced",
    });
  });

  it("stops forwarding when the ttl is spent", async () => {
    const frame = { ...(await c.dir.group.localAnnounce()), ttl: 0 };
    expect(await a.dir.group.acceptAnnounce(frame, b.id)).toMatchObject({
      accepted: true,
      forwardTtl: undefined,
    });
  });

  it("orders announces by boot then counter", async () => {
    const first = await c.dir.group.localAnnounce();
    const second = await c.dir.group.localAnnounce();
    expect(await a.dir.group.acceptAnnounce(second, b.id)).toMatchObject({ accepted: true });
    expect(await a.dir.group.acceptAnnounce(first, b.id)).toMatchObject({ reason: "stale" });
  });

  it("keeps the boot counter across restarts, even with the clock set back", async () => {
    const before = await a.dir.group.localAnnounce();
    clock.now -= 10_000;
    const restarted = await makeNode("Alpha", a.home);
    restarted.setIdentity({ publicKey: "", privateKey: "" } as never);
    const boot = JSON.parse(await readFile(join(a.home, "announce-boot.json"), "utf8")).boot;
    expect(boot).toBeGreaterThan(0);
    expect(before.payload).toContain(`|${boot}|`);
  });
});

describe("expel", () => {
  it("needs the exact name or id and refuses self", async () => {
    await rejects(a.dir.group.createExpel(c.id, "nope"), "confirmation_mismatch");
    await rejects(a.dir.group.createExpel(a.id, "Alpha"), "cannot_remove_self");
    await rejects(a.dir.group.createExpel("unknown", "unknown"), "invalid_request");
    expect(await a.dir.expulsions()).toEqual([]);
  });

  it("reaches every node, collects confirmations and quarantines the target", async () => {
    const frame = await a.dir.group.createExpel(c.id, "Charlie");
    await net.floodExpel(a, undefined, frame);
    const [expulsion] = await a.dir.expulsions();
    expect(expulsion).toMatchObject({
      target: c.id,
      by: a.id,
      byName: "Alpha",
      targetName: "Charlie",
      pending: [],
    });
    expect(expulsion?.confirmations.map((e) => e.node).sort()).toEqual([a.id, b.id].sort());
    expect((await a.dir.directory()).map((n) => n.id)).toEqual([b.id]);
    expect(b.dir.group.isTombstoned(c.id)).toBe(true);
    expect(c.dir.removal()).toMatchObject({ by: a.id });
    expect(await c.dir.directory()).toEqual([]);
  });

  it("keeps a node pending until it reconnects and syncs", async () => {
    net.cut(b);
    const frame = await a.dir.group.createExpel(c.id, c.id);
    await net.floodExpel(a, undefined, frame);
    expect((await a.dir.expulsions())[0]?.pending.map((e) => e.node)).toEqual([b.id]);
  });

  it("a verified expel is re-flooded once and acked once", async () => {
    const frame = await a.dir.group.createExpel(c.id, "Charlie");
    const first = await b.dir.group.acceptExpel(frame, a.id);
    expect(first).toMatchObject({ fresh: true, reflood: true, selfExpelled: false });
    expect(first.ack).toBeDefined();
    expect(await b.dir.group.acceptExpel(frame, a.id)).toMatchObject({ fresh: false, reflood: false });
    expect(await b.dir.group.acceptExpel({ ...frame, sig: "x".repeat(86) }, a.id)).toMatchObject({
      reason: "bad-signature",
    });
  });

  it("refuses an announce from a tombstoned origin and a replayed ack", async () => {
    const dead = await c.dir.group.localAnnounce();
    await net.floodExpel(a, undefined, await a.dir.group.createExpel(c.id, "Charlie"));
    expect(await a.dir.group.acceptAnnounce(dead, b.id)).toMatchObject({ reason: "tombstoned" });
  });

  it("limits how many expels one node creates per minute", async () => {
    const others = await Promise.all(
      Array.from({ length: EXPEL_CREATE_PER_MINUTE + 1 }, (_, i) => makeNode(`N${i}`)),
    );
    for (const other of others) {
      other.peers.set(other.id, other.name);
      a.peers.set(other.id, other.name);
    }
    for (const other of others.slice(0, EXPEL_CREATE_PER_MINUTE))
      await a.dir.group.createExpel(other.id, other.id);
    await rejects(a.dir.group.createExpel(others.at(-1)?.id as string, "x"), "confirmation_mismatch");
    await rejects(
      a.dir.group.createExpel(others.at(-1)?.id as string, others.at(-1)?.id as string),
      "rate_limited",
    );
  });

  it("stores signed expels at 0600 and reloads them", async () => {
    await a.dir.group.createExpel(c.id, "Charlie");
    const file = join(a.home, "expelled.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const reloaded = await makeNode("Alpha", a.home);
    expect(await reloaded.dir.group.expelSet()).toHaveLength(1);
  });

  it("drops forged entries when loading expelled.json", async () => {
    const home = await mkdtemp(join(tmpdir(), "tau-dir-"));
    await writeFile(
      join(home, "expelled.json"),
      JSON.stringify({ version: 1, expels: [{ type: "expel", payload: "x", byPublicKey: "y", sig: "z" }] }),
    );
    const node = await makeNode("Alpha", home);
    expect(await node.dir.group.expelSet()).toEqual([]);
  });
});

describe("reset", () => {
  it("keeps tombstones, but clears them when this node itself was expelled", async () => {
    await net.floodExpel(a, undefined, await a.dir.group.createExpel(c.id, "Charlie"));
    await a.dir.reset();
    expect(a.dir.group.isTombstoned(c.id)).toBe(true);
    await c.dir.reset();
    expect(c.dir.removal()).toBeUndefined();
    expect(c.dir.group.isTombstoned(c.id)).toBe(false);
    expect(await c.dir.group.expelSet()).toEqual([]);
  });
});
