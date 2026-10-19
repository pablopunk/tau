import { type Peer, type PeersStore, peerIdOf } from "@tau/core";
import type { Core } from "@tau/protocol";
import type { AttachPeer } from "@tau/server";
import { type LinkTuning, type PeerWorker, peerKey, startPeerWorker } from "./peer-dialler";

export type { LinkTuning } from "./peer-dialler";

/** `run.ts` calls exactly this. */
export interface LinkClientOptions {
  /** FROZEN seam: the symmetric peer runs on a dialled socket through `server.attachPeer(socket, "dialler", peerInfo)`. */
  readonly attachPeer: AttachPeer;
  /** Every dialled peer (`<home>/peers.json`), polled so `tau connect` needs no restart. */
  readonly peers: PeersStore;
  /** The client reports its state per peer with `core.nodes.reportLink(peerId, state)`. */
  readonly core: Core;
}

export interface LinkClient {
  /** Closes every peer link and its in-flight streams. */
  stop(): Promise<void>;
}

export type StartLinkClient = (options: LinkClientOptions) => LinkClient;

const DEFAULT_TUNING: LinkTuning = {
  pollMs: 1000,
  backoffBaseMs: 1000,
  backoffMaxMs: 30_000,
  standbyMs: 60_000,
  unreachableAfter: 3,
  log: (message) => console.log(`[link] ${message}`),
};

/** Polls `peers.json` and keeps one link per entry; entries come and go while the server runs. */
export function startLinkClientWith(options: LinkClientOptions, tuning: LinkTuning): LinkClient {
  const { core, peers, attachPeer } = options;
  const workers = new Map<string, PeerWorker>();
  let stopped = false;
  let wake: (() => void) | undefined;

  async function acceptedLinkTo(nodeId: string): Promise<boolean> {
    const nodes = await core.nodes.list().catch(() => []);
    return nodes.some(
      (node) =>
        node.id === nodeId &&
        node.links.some((link) => link.direction === "accepted" && link.state === "linked"),
    );
  }

  async function isStandby(peer: Peer): Promise<boolean> {
    if (peer.nodeId === undefined) return false;
    const other = [...workers.values()].some(
      (worker) =>
        worker.linked() && peerIdOf(worker.peer()) === peerIdOf(peer) && worker.peer().url !== peer.url,
    );
    return other || (await acceptedLinkTo(peer.nodeId));
  }

  async function sync(): Promise<void> {
    const entries = await peers.read();
    const wanted = new Map(entries.map((entry) => [peerKey(entry), entry]));
    for (const [key, worker] of workers) {
      if (wanted.has(key)) continue;
      workers.delete(key);
      await worker.stop();
    }
    for (const [key, entry] of wanted) {
      const worker = workers.get(key);
      if (worker) worker.update(entry);
      else workers.set(key, startPeerWorker(entry, { core, attachPeer, tuning, isStandby }));
    }
  }

  const running = (async () => {
    while (!stopped) {
      await sync().catch((error: unknown) =>
        tuning.log(`peers sync failed: ${error instanceof Error ? error.message : String(error)}`),
      );
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, tuning.pollMs);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  })();

  return {
    async stop() {
      stopped = true;
      wake?.();
      await running;
      await Promise.all([...workers.values()].map((worker) => worker.stop()));
      workers.clear();
    },
  };
}

export const startLinkClient: StartLinkClient = (options) => startLinkClientWith(options, DEFAULT_TUNING);
