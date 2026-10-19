import { createHash } from "node:crypto";
import { type Peer, peerIdOf, standbyDialDue } from "@tau/core";
import {
  type Core,
  LINK_CLOSE_DUPLICATE,
  LINK_CLOSE_POLICY,
  LINK_CLOSE_REMOVED,
  LINK_CLOSE_UPDATE_REQUIRED,
  type NodeLinkState,
} from "@tau/protocol";
import type { AttachPeer, PeerClosed, PeerHandle } from "@tau/server";
import WebSocket from "ws";
import { linkUrlOf, originOf } from "./link-endpoint";
import { linkReportOf } from "./link-reports";

export interface LinkTuning {
  readonly pollMs: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  /** A standby (another live link to the same node) is looked at again this often. */
  readonly standbyMs: number;
  /** Failed attempts in a row before the state is `unreachable`. */
  readonly unreachableAfter: number;
  readonly log: (message: string) => void;
  /** Clock for the standby rule; tests move it. */
  readonly now?: () => number;
}

export interface PeerWorkerDeps {
  readonly core: Core;
  readonly attachPeer: AttachPeer;
  readonly tuning: LinkTuning;
  /** True when another live link already reaches this peer's node. */
  isStandby(peer: Peer): Promise<boolean>;
}

export interface PeerWorker {
  /** The latest `peers.json` entry for this worker (the node id may be learned meanwhile). */
  update(peer: Peer): void;
  readonly peer: () => Peer;
  readonly linked: () => boolean;
  stop(): Promise<void>;
}

type Outcome =
  | { kind: "retry"; linked: boolean }
  | { kind: "update-required"; linked: boolean }
  | { kind: "duplicate" }
  | { kind: "removed" }
  | { kind: "final"; state: NodeLinkState; message?: string };

const REFUSED_STATUSES = new Set([401, 403]);

export const secretKeyOf = (secret: string): string => createHash("sha256").update(secret).digest("hex");
/** What identifies one dialled connection: a new url or secret is a new link. */
export const peerKey = (peer: Peer): string => `${peer.url}\n${peer.secret}`;

function outcomeOf(closed: PeerClosed): Outcome {
  // The other node's `Disconnect`: it forgot this node, so this one forgets it too (the dialog promises both).
  if (closed.bye && closed.reason === "disconnect") return { kind: "removed" };
  if (closed.bye) return { kind: "final", state: "refused", message: "The other node closed this link." };
  if (closed.code === LINK_CLOSE_DUPLICATE) return { kind: "duplicate" };
  if (closed.code === LINK_CLOSE_REMOVED)
    return { kind: "final", state: "refused", message: "The other node removed this node." };
  if (closed.code === LINK_CLOSE_POLICY) return { kind: "final", state: "refused" };
  if (closed.code === LINK_CLOSE_UPDATE_REQUIRED) return { kind: "update-required", linked: closed.linked };
  return { kind: "retry", linked: closed.linked };
}

/** Keeps one link up to one peer: dial, attach, map how it ended to a state and a backoff. */
export function startPeerWorker(initial: Peer, deps: PeerWorkerDeps): PeerWorker {
  const { core, tuning } = deps;
  let peer = initial;
  let stopped = false;
  let socket: WebSocket | undefined;
  let handle: PeerHandle | undefined;
  let isLinked = false;
  let wake: (() => void) | undefined;
  let lastState: NodeLinkState | undefined;
  let since = Date.now();

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  const report = (state: NodeLinkState, message?: string) => {
    if (state !== lastState) since = Date.now();
    lastState = state;
    core.nodes.reportLink(peerIdOf(peer), linkReportOf(state, since, message));
  };

  function dial(target: Peer): Promise<Outcome> {
    return new Promise((resolve) => {
      let attached = false;
      const ws = new WebSocket(linkUrlOf(target.url), {
        headers: { authorization: `Bearer ${target.secret}`, origin: originOf(target.url) },
        handshakeTimeout: 15_000,
      });
      socket = ws;
      ws.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(
          REFUSED_STATUSES.has(response.statusCode ?? 0)
            ? { kind: "final", state: "refused" }
            : { kind: "retry", linked: false },
        );
      });
      ws.once("error", () => {
        if (!attached) resolve({ kind: "retry", linked: false });
      });
      ws.once("open", () => {
        attached = true;
        const attachedHandle = deps.attachPeer(ws, "dialler", {
          peerId: peerIdOf(target),
          ...(target.nodeId !== undefined && { pinnedNodeId: target.nodeId }),
          secretKey: secretKeyOf(target.secret),
        });
        handle = attachedHandle;
        isLinked = true;
        report("linked");
        void attachedHandle.closed.then((closed) => resolve(outcomeOf(closed)));
      });
    });
  }

  async function loop(): Promise<void> {
    let attempts = 0;
    let wasLinked = false;
    let lastTriedAt = 0;
    let onStandby = false;
    report("connecting");
    while (!stopped) {
      const live = await deps.isStandby(peer);
      if (
        live ||
        (onStandby && !standbyDialDue({ lastTriedAt, liveLinkExists: false }, (tuning.now ?? Date.now)()))
      ) {
        onStandby = true;
        report("standby");
        await sleep(tuning.standbyMs);
        continue;
      }
      onStandby = false;
      lastTriedAt = (tuning.now ?? Date.now)();
      const outcome = await dial(peer);
      isLinked = false;
      handle = undefined;
      socket = undefined;
      if (stopped) return;
      if (outcome.kind === "removed") {
        await core.nodes.disconnect(peerIdOf(peer)).catch(() => undefined);
        return;
      }
      if (outcome.kind === "duplicate") {
        // 4002: a live link to this node wins (glare or second link) and this entry waits as standby.
        // Without one it is a second-device duplicate or the flap guard: reported, never retried.
        if (!(await deps.isStandby(peer))) return report("duplicate");
        onStandby = true;
        continue;
      }
      if (outcome.kind === "final") return report(outcome.state, outcome.message);
      wasLinked ||= outcome.linked;
      attempts = outcome.linked ? 1 : attempts + 1;
      if (outcome.kind === "update-required") report("update-required");
      else if (attempts >= tuning.unreachableAfter) report("unreachable");
      else report(wasLinked ? "reconnecting" : "connecting");
      await sleep(Math.min(tuning.backoffMaxMs, tuning.backoffBaseMs * 2 ** Math.max(0, attempts - 1)));
    }
  }

  const running = loop().catch((error: unknown) => {
    tuning.log(
      `link to ${new URL(peer.url).host} stopped: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  return {
    update: (next) => {
      peer = next;
    },
    peer: () => peer,
    linked: () => isLinked,
    async stop() {
      stopped = true;
      wake?.();
      handle?.close(1000, "stopping");
      const current = socket;
      if (current) {
        current.close(1000, "stopping");
        setTimeout(() => current.terminate(), 1000).unref();
      }
      await running;
    },
  };
}
