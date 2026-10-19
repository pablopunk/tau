import type { AckOutcome, ExpelFrame, ExpelOutcome, NodeGroup } from "@tau/protocol";
import { AppError, computeRoutes, EXPEL_CREATE_PER_MINUTE, forwardTtl, ROUTE_TTL_START } from "@tau/protocol";
import { verifyAck, verifyAnnounce, verifyExpel } from "@tau/protocol/identity";
import { createAnnounceSequence } from "./announce-sequence";
import { createAnnounceTable } from "./announce-table";
import { buildDirectory } from "./directory-view";
import { createExpelStore, type StoredExpel } from "./expel-store";
import type { Directory } from "./ports";
import { type DirectoryDepsWithSelf, defaultSelf, signAck, signAnnounce, signExpel } from "./sign-frames";

interface Removal {
  readonly by: string;
  readonly at: number;
}

const MINUTE_MS = 60_000;

export function createDirectoryState(deps: DirectoryDepsWithSelf): Directory {
  const table = createAnnounceTable(deps.now);
  const store = createExpelStore(deps.expelledFile, deps.now);
  const sequence = createAnnounceSequence(deps.home, deps.now);
  const links = new Set<string>();
  const synced = new Set<string>();
  const skew = new Map<string, number>();
  const acks = new Map<string, Map<string, number>>();
  const lastNames = new Map<string, string>();
  const createdAt: number[] = [];
  const topologyListeners = new Set<() => void>();
  const tombstoneListeners = new Set<(target: string) => void>();
  let removal: Removal | undefined;
  const ready = store.load().then(() => {
    removal = loadedRemoval();
  });
  const selfId = () => deps.identity().nodeId;
  const loadedRemoval = (): Removal | undefined => {
    const own = store.get(selfId());
    return own ? { by: own.record.by, at: own.record.time } : undefined;
  };
  const tombstoned = (id: string) => store.get(id) !== undefined;
  const neighbours = () => [...links].filter((id) => synced.has(id) && !tombstoned(id)).sort();
  const routeTable = () =>
    computeRoutes({
      self: selfId(),
      links: neighbours(),
      records: table.records(),
      tombstoned: new Set(store.all().map((entry) => entry.record.target)),
    });
  const emitTopology = () => {
    deps.changes.emit({ resource: "nodes" });
    for (const listener of [...topologyListeners]) listener();
  };
  const sweep = () => {
    if (table.sweep()) emitTopology();
  };
  const nameOf = async (id: string): Promise<string | null> => {
    if (id === selfId()) return deps.self?.().name ?? defaultSelf().name;
    const peer = (await deps.nodes.list()).find((node) => node.id === id);
    return peer?.name ?? table.get(id)?.name ?? lastNames.get(id) ?? null;
  };
  const protectedIds = async () => new Set([...links, ...(await deps.nodes.list()).map((node) => node.id)]);

  async function learn(stored: StoredExpel): Promise<"added" | "capacity"> {
    const result = await store.add(stored, await protectedIds());
    if (result !== "added") return result;
    const { target } = stored.record;
    const known = await nameOf(target);
    if (known !== null) lastNames.set(target, known);
    table.remove(target);
    links.delete(target);
    synced.delete(target);
    if (target === selfId()) removal = { by: stored.record.by, at: stored.record.time };
    for (const listener of [...tombstoneListeners]) listener(target);
    await deps.nodes.forget(target).catch(() => undefined);
    emitTopology();
    return "added";
  }

  const ackOf = (target: string, node: string, at: number) => {
    const row = acks.get(target) ?? new Map<string, number>();
    const fresh = !row.has(node);
    if (fresh) row.set(node, at);
    acks.set(target, row);
    return fresh;
  };

  async function acceptExpel(frame: ExpelFrame): Promise<ExpelOutcome> {
    await ready;
    const verdict = verifyExpel(frame);
    if (!verdict.ok) return { fresh: false, reflood: false, selfExpelled: false, reason: verdict.reason };
    const { target } = verdict.record;
    const selfExpelled = target === selfId();
    if (store.get(target)) return { fresh: false, target, reflood: false, selfExpelled };
    if ((await learn({ frame, record: verdict.record })) === "capacity") {
      return { fresh: false, target, reflood: false, selfExpelled: false, reason: "capacity" };
    }
    if (selfExpelled) return { fresh: true, target, reflood: true, selfExpelled };
    const ack = signAck(deps.identity(), target, deps.now());
    ackOf(target, selfId(), deps.now());
    return { fresh: true, target, reflood: true, ack, selfExpelled };
  }

  const group: NodeGroup = {
    async localAnnounce() {
      await ready;
      sweep();
      const { boot, counter } = await sequence.next();
      const self = deps.self?.() ?? defaultSelf();
      return signAnnounce(
        deps.identity(),
        { boot, counter, neighbours: neighbours(), self },
        ROUTE_TTL_START,
      );
    },
    linkUp(peerId) {
      if (tombstoned(peerId)) return;
      links.add(peerId);
      emitTopology();
    },
    linkDown(peerId) {
      links.delete(peerId);
      synced.delete(peerId);
      emitTopology();
    },
    async acceptAnnounce(frame, fromPeerId) {
      await ready;
      const refuse = (reason: NonNullable<Awaited<ReturnType<NodeGroup["acceptAnnounce"]>>["reason"]>) => ({
        accepted: false,
        reason,
      });
      if (!links.has(fromPeerId)) return refuse("capability");
      if (!synced.has(fromPeerId)) return refuse("unsynced");
      const peekOrigin = frame.payload.split("|")[1] ?? "";
      const verdict = verifyAnnounce(frame, { knownKey: table.get(peekOrigin)?.publicKey });
      if (!verdict.ok) return refuse(verdict.reason);
      const { record } = verdict;
      if (record.origin === selfId()) return refuse("about-self");
      if (tombstoned(record.origin)) return refuse("tombstoned");
      if (table.isStale(record)) return refuse("stale");
      const undo = table.set(record);
      if (routeTable().ignored.includes(record.origin)) {
        undo();
        return refuse("cap-reached");
      }
      emitTopology();
      return { accepted: true, forwardTtl: forwardTtl(frame.ttl) };
    },
    acceptExpel: (frame) => acceptExpel(frame),
    async acceptAck(frame) {
      await ready;
      const verdict = verifyAck(frame);
      const none: AckOutcome = { fresh: false, reflood: false };
      if (
        !verdict.ok ||
        !tombstoned(verdict.record.target) ||
        verdict.record.node === verdict.record.target
      ) {
        return none;
      }
      const fresh = ackOf(verdict.record.target, verdict.record.node, verdict.record.time);
      if (fresh) deps.changes.emit({ resource: "nodes" });
      return { fresh, reflood: fresh };
    },
    async expelSet() {
      await ready;
      return store.all().map((entry) => entry.frame);
    },
    async acceptExpelSet(frames, fromPeerId) {
      const outcomes: ExpelOutcome[] = [];
      for (const frame of frames) outcomes.push(await acceptExpel(frame));
      if (links.has(fromPeerId) && !tombstoned(fromPeerId)) {
        synced.add(fromPeerId);
        emitTopology();
      }
      return outcomes;
    },
    markUnsynced(peerId) {
      if (synced.delete(peerId)) emitTopology();
    },
    async createExpel(target, confirm) {
      await ready;
      if (target === selfId()) throw new AppError("cannot_remove_self", "A node cannot remove itself.");
      const name = await nameOf(target);
      if (name === null && !tombstoned(target)) throw new AppError("invalid_request", "Unknown node.");
      if (confirm !== target && confirm !== name) {
        throw new AppError("confirmation_mismatch", "Type the node's exact name or id to remove it.");
      }
      const now = deps.now();
      while (createdAt.length > 0 && now - (createdAt[0] as number) >= MINUTE_MS) createdAt.shift();
      if (createdAt.length >= EXPEL_CREATE_PER_MINUTE) {
        throw new AppError("rate_limited", "Too many removals. Wait a minute.");
      }
      const existing = store.get(target);
      if (existing) return existing.frame;
      const frame = signExpel(deps.identity(), target, now);
      const verdict = verifyExpel(frame);
      if (!verdict.ok) throw new AppError("internal", "Could not sign the removal.");
      if ((await learn({ frame, record: verdict.record })) === "capacity") {
        throw new AppError("rate_limited", "The removal list is full.");
      }
      createdAt.push(now);
      ackOf(target, selfId(), now);
      return frame;
    },
    route: (dest) => (dest === selfId() ? undefined : routeTable().routes.get(dest)),
    isTombstoned: tombstoned,
    neighbours,
    onTopology(listener) {
      topologyListeners.add(listener);
      return () => void topologyListeners.delete(listener);
    },
    onTombstone(listener) {
      tombstoneListeners.add(listener);
      return () => void tombstoneListeners.delete(listener);
    },
    recordSkew(nodeId, skewMs) {
      skew.set(nodeId, skewMs);
    },
  };

  return {
    group,
    async directory() {
      await ready;
      sweep();
      if (removal) return [];
      return buildDirectory({
        peers: await deps.nodes.list(),
        records: table.all(),
        live: table.live,
        receivedAt: table.receivedAt,
        routes: routeTable().routes,
        tombstoned,
        selfId: selfId(),
        synced: (id) => synced.has(id),
        linked: (id) => links.has(id),
        skew: (id) => skew.get(id),
      });
    },
    async expulsions() {
      await ready;
      const peers = await deps.nodes.list();
      const members = new Map<string, string>([[selfId(), (await nameOf(selfId())) as string]]);
      for (const peer of peers) members.set(peer.id, peer.name);
      for (const record of table.all())
        if (!members.has(record.origin)) members.set(record.origin, record.name);
      return Promise.all(
        store.all().map(async ({ record }) => {
          const confirmed = acks.get(record.target) ?? new Map<string, number>();
          return {
            target: record.target,
            targetName: await nameOf(record.target),
            by: record.by,
            byName: await nameOf(record.by),
            at: record.time,
            confirmations: [...confirmed].map(([node, at]) => ({
              node,
              name: members.get(node) ?? node,
              at,
            })),
            pending: [...members]
              .filter(([id]) => id !== record.target && !confirmed.has(id) && !tombstoned(id))
              .map(([node, name]) => ({ node, name })),
          };
        }),
      );
    },
    async reset() {
      await ready;
      const wasExpelled = removal !== undefined;
      removal = undefined;
      table.clear();
      links.clear();
      synced.clear();
      skew.clear();
      acks.clear();
      lastNames.clear();
      sequence.restart();
      if (wasExpelled) await store.clear();
      emitTopology();
    },
    removal: () => removal,
  };
}
